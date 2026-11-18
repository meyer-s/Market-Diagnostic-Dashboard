"""On-demand, private reader for the current r/wallstreetbets discussion."""

import base64
from datetime import datetime, timezone
from hmac import compare_digest
import json
from os import environ
import re
from threading import Lock
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


REDDIT = "https://www.reddit.com"
OAUTH = "https://oauth.reddit.com"
SUBREDDIT = "/r/wallstreetbets"
READ_INTERVAL = 60
MAX_REPLIES = 25
PIN_PATH = re.compile(r"/r/wallstreetbets/comments/([a-z0-9]{1,16})(?:/[^/]*)?/?$", re.I)
REDDIT_ID = re.compile(r"[a-z0-9]{1,16}")
DISCUSSION = re.compile(r"^(?:daily discussion thread|weekend discussion thread|what are your moves tomorrow)\b", re.I)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def listing(value):
    return value["data"]["children"]


def pin_id(location):
    url = urlsplit(urljoin(OAUTH, location))
    if url.scheme == "https" and url.netloc in {"oauth.reddit.com", "www.reddit.com"}:
        match = PIN_PATH.fullmatch(url.path.removesuffix("/.json"))
        if match:
            return match.group(1).lower()
    raise ValueError("Unexpected Reddit thread")


def iso_time(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


class WsbReader:
    def __init__(self):
        self.client_id = environ.get("WSB_REDDIT_CLIENT_ID", "")
        self.client_secret = environ.get("WSB_REDDIT_CLIENT_SECRET", "")
        self.user_agent = environ.get("WSB_REDDIT_USER_AGENT", "")
        self.access_key = environ.get("WSB_READER_ACCESS_KEY", "")
        self.opener = build_opener(NoRedirect())
        self.lock = Lock()
        self.token = ""
        self.token_until = 0.0
        self.retry_at = 0.0
        self.cached = None

    def authorized(self, header):
        if not all((self.access_key, self.client_id, self.client_secret, self.user_agent)):
            return False
        return compare_digest((header or "").encode(), f"Bearer {self.access_key}".encode())

    def request(self, url, *, authorization, data=None):
        return self.opener.open(Request(url, data=data, headers={
            "Authorization": authorization,
            "User-Agent": self.user_agent,
            "Accept": "application/json",
        }), timeout=2.0)

    def get_token(self):
        if self.token and monotonic() < self.token_until:
            return self.token
        credentials = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        with self.request(f"{REDDIT}/api/v1/access_token", authorization=f"Basic {credentials}",
                          data=b"grant_type=client_credentials") as response:
            payload = json.load(response)
        self.token = payload["access_token"]
        self.token_until = monotonic() + max(0, int(payload["expires_in"]) - 60)
        return self.token

    def pinned_id(self, slot, authorization):
        try:
            with self.request(f"{OAUTH}{SUBREDDIT}/about/sticky?num={slot}", authorization=authorization) as response:
                payload = json.load(response)
            post = listing(payload[0] if isinstance(payload, list) else payload)[0]["data"]
            ident = post["id"]
            if REDDIT_ID.fullmatch(ident):
                return ident
            raise ValueError("Missing Reddit thread ID")
        except HTTPError as error:
            if error.code not in {301, 302, 303, 307, 308}:
                raise
            with error:
                return pin_id(error.headers.get("Location", ""))

    def read_thread(self):
        authorization = f"Bearer {self.get_token()}"
        for slot in (1, 2):
            ident = self.pinned_id(slot, authorization)
            endpoint = f"{OAUTH}{SUBREDDIT}/comments/{ident}?sort=new&depth=1&limit={MAX_REPLIES}&raw_json=1"
            with self.request(endpoint, authorization=authorization) as response:
                post_listing, comment_listing = json.loads(response.read(1_500_000))
            post = listing(post_listing)[0]["data"]
            if post["id"] == ident and post["subreddit"].casefold() == "wallstreetbets" and DISCUSSION.match(post["title"]):
                break
        else:
            raise ValueError("No pinned WSB discussion")

        thread_url = f"{REDDIT}{SUBREDDIT}/comments/{ident}/"
        replies = []
        for item in listing(comment_listing):
            if item.get("kind") != "t1":
                continue
            comment = item["data"]
            if not REDDIT_ID.fullmatch(comment.get("id", "")):
                continue
            if comment.get("body") in {"", None, "[deleted]", "[removed]"} or comment.get("author") in {None, "[deleted]"}:
                continue
            replies.append({
                "id": comment["id"], "author": comment["author"], "body": comment["body"],
                "published_at": iso_time(comment["created_utc"]),
                "url": f"{thread_url}_/{comment['id']}/",
            })
        replies.sort(key=lambda reply: reply["published_at"], reverse=True)
        return {
            "title": post["title"], "url": f"{thread_url}?sort=new",
            "published_at": iso_time(post["created_utc"]),
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "replies": replies[:MAX_REPLIES],
        }

    def read(self):
        with self.lock:
            if monotonic() >= self.retry_at:
                delay = READ_INTERVAL
                try:
                    self.cached = self.read_thread()
                except HTTPError as error:
                    self.cached = None
                    if error.code == 401:
                        self.token = ""
                    retry = error.headers.get("Retry-After", "")
                    delay = max(120, int(retry) if retry.isdecimal() else 0)
                    error.close()
                except (URLError, OSError, KeyError, IndexError, ValueError, TypeError):
                    self.cached = None
                    delay = 120
                self.retry_at = monotonic() + delay
            return {
                "discussion": self.cached,
                "retry_seconds": max(1, round(self.retry_at - monotonic())),
            }

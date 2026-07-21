from starlette.middleware.gzip import GZipMiddleware

from app.main import app


def test_api_enables_gzip_for_large_responses() -> None:
    assert any(middleware.cls is GZipMiddleware for middleware in app.user_middleware)

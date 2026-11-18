FROM python:3.11-slim

RUN useradd --create-home --shell /usr/sbin/nologin appuser && \
    install -d -o appuser -g appuser /app/live-news

WORKDIR /app
COPY app/services/live_news.py app/services/wsb_reader.py /app/app/services/
USER appuser

EXPOSE 8765
CMD ["python", "-u", "-m", "app.services.live_news"]

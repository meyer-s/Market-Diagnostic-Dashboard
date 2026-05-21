FROM python:3.11-slim

WORKDIR /app

COPY ./requirements.txt /app/requirements.txt
COPY ./app /app/app
COPY ./alembic /app/alembic
COPY ./alembic.ini /app/alembic.ini
COPY ./seed_indicators.py /app/seed_indicators.py
COPY ./startup.sh /app/startup.sh

RUN pip install --upgrade pip && \
    pip install -r /app/requirements.txt && \
    useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app && \
    chmod +x /app/startup.sh

USER appuser

EXPOSE 8000

CMD ["/app/startup.sh"]

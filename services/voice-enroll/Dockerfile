FROM docker.m.daocloud.io/library/python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

ENV ENROLL_HOST=0.0.0.0
ENV ENROLL_PORT=8787
ENV ENROLL_DB=/data/enroll.db
ENV ENROLL_TTS_DIR=/tts

EXPOSE 8787
CMD ["python", "-m", "app.main"]

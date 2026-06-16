FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive
ARG IBGATEWAY_INSTALLER_URL=https://download2.interactivebrokers.com/installers/ibgateway/latest-standalone/ibgateway-latest-standalone-linux-x64.sh
ARG IBGATEWAY_INSTALLER_SHA256=

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      fluxbox \
      libasound2 \
      libfontconfig1 \
      libfreetype6 \
      libgtk-3-0 \
      libnss3 \
      libx11-6 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxrandr2 \
      libxrender1 \
      libxss1 \
      libxtst6 \
      novnc \
      procps \
      websockify \
      x11vnc \
      xvfb && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "${IBGATEWAY_INSTALLER_URL}" -o /tmp/ibgateway-installer.sh && \
    if [ -n "${IBGATEWAY_INSTALLER_SHA256}" ]; then \
      echo "${IBGATEWAY_INSTALLER_SHA256}  /tmp/ibgateway-installer.sh" | sha256sum -c -; \
    fi && \
    chmod +x /tmp/ibgateway-installer.sh && \
    /tmp/ibgateway-installer.sh -q -dir /opt/ibgateway && \
    sed -i 's#/root/Jts#/home/ibgateway/Jts#g' /opt/ibgateway/.install4j/response.varfile && \
    rm -f /tmp/ibgateway-installer.sh

RUN useradd --create-home --shell /bin/bash ibgateway && \
    mkdir -p /home/ibgateway/Jts && \
    chown -R ibgateway:ibgateway /home/ibgateway /opt/ibgateway

COPY entrypoint.sh /usr/local/bin/ibgateway-entrypoint.sh
RUN chmod +x /usr/local/bin/ibgateway-entrypoint.sh

USER ibgateway
WORKDIR /home/ibgateway

ENV DISPLAY=:1
ENV HOME=/home/ibgateway

VOLUME ["/home/ibgateway/Jts"]
EXPOSE 4001 4002 5900 6080

ENTRYPOINT ["/usr/local/bin/ibgateway-entrypoint.sh"]

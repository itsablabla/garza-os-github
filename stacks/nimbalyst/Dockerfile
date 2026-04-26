FROM lscr.io/linuxserver/webtop:ubuntu-xfce

# Node.js for Codex CLI and Claude Code CLI, plus deps for AppImage extraction
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates git jq fuse libfuse2 xdg-utils \
      libnss3 libgbm1 libasound2t64 libgtk-3-0 libxss1 libx11-xcb1 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Codex CLI and Claude Code CLI globally
RUN npm install -g @openai/codex @anthropic-ai/claude-code

# Download and extract Nimbalyst AppImage (avoids FUSE requirement at runtime)
RUN mkdir -p /opt/nimbalyst && cd /opt/nimbalyst \
    && curl -fL -o Nimbalyst.AppImage \
       "https://github.com/Nimbalyst/nimbalyst/releases/latest/download/Nimbalyst-Linux.AppImage" \
    && chmod +x Nimbalyst.AppImage \
    && ./Nimbalyst.AppImage --appimage-extract >/dev/null \
    && mv squashfs-root nimbalyst-app \
    && rm Nimbalyst.AppImage \
    && chmod -R a+rX /opt/nimbalyst

# Wrapper so PATH-invocation works and APPDIR is set explicitly
RUN printf '#!/bin/bash\nexport APPDIR=/opt/nimbalyst/nimbalyst-app\ncd "$APPDIR"\nexec ./@nimbalystelectron --no-sandbox "$@"\n' \
      > /usr/local/bin/nimbalyst && chmod +x /usr/local/bin/nimbalyst

# Desktop launcher + autostart
RUN mkdir -p /etc/skel/Desktop /etc/skel/.config/autostart && \
    printf '%s\n' \
      '[Desktop Entry]' \
      'Version=1.0' \
      'Type=Application' \
      'Name=Nimbalyst' \
      'Comment=Visual workspace for Codex and Claude Code' \
      'Exec=/usr/local/bin/nimbalyst' \
      'Icon=/opt/nimbalyst/nimbalyst-app/nimbalyst.png' \
      'Terminal=false' \
      'Categories=Development;' \
      > /etc/skel/Desktop/Nimbalyst.desktop && \
    chmod +x /etc/skel/Desktop/Nimbalyst.desktop && \
    cp /etc/skel/Desktop/Nimbalyst.desktop /etc/skel/.config/autostart/Nimbalyst.desktop

# ---- GARZA LLM configuration (baked in) ----

# 1) System-wide env vars for any login shell (xfce4-terminal spawns login shells).
RUN printf '%s\n' \
      'export OPENAI_BASE_URL=https://llm.garzaos.cloud/v1' \
      'export OPENAI_API_BASE=https://llm.garzaos.cloud/v1' \
      'export OPENAI_API_KEY=${CUSTOM_LLM_API_KEY}' \
      > /etc/profile.d/garza-llm.sh && chmod 0644 /etc/profile.d/garza-llm.sh

# 2) Also export into non-login interactive shells.
RUN printf '\n# ChatGPT-backed LLM endpoint\n[ -f /etc/profile.d/garza-llm.sh ] && . /etc/profile.d/garza-llm.sh\n' \
      >> /etc/bash.bashrc

# 3) Default Codex config.toml for new users (baked into skel).
RUN mkdir -p /etc/skel/.codex && \
    printf '%s\n' \
      'model_provider = "garza"' \
      'model = "gpt-5.4"' \
      'approval_policy = "never"' \
      'sandbox_mode = "danger-full-access"' \
      '' \
      '[model_providers.garza]' \
      'name = "Garza LLM (ChatGPT-backed)"' \
      'base_url = "https://llm.garzaos.cloud/v1"' \
      'env_key = "OPENAI_API_KEY"' \
      'wire_api = "responses"' \
      '' \
      '[projects."/config"]' \
      'trust_level = "trusted"' \
      > /etc/skel/.codex/config.toml

# 4) Test helper (gtest) to verify end-to-end routing from any terminal.
RUN printf '%s\n' \
      '#!/bin/bash' \
      '. /etc/profile.d/garza-llm.sh' \
      'export HOME=/config' \
      'cd /config' \
      'echo === A3: ENV ===' \
      'echo OPENAI_BASE_URL=$OPENAI_BASE_URL' \
      'echo OPENAI_API_KEY=${OPENAI_API_KEY:0:15}...' \
      'echo' \
      'echo === A4: CODEX ===' \
      'codex exec --skip-git-repo-check "reply with exactly the single word PONG and nothing else" 2>&1 | tail -15' \
      > /usr/local/bin/gtest && chmod +x /usr/local/bin/gtest

# 5) Custom entrypoint hook: seed /config with config.toml + desktop launcher
#    and ensure everything in /config is owned by abc:abc so Codex can write
#    its sqlite files without EACCES. This runs at every container start via
#    linuxserver's /custom-cont-init.d/ mechanism.
RUN mkdir -p /custom-cont-init.d && \
    printf '%s\n' \
      '#!/usr/bin/with-contenv bash' \
      'set -e' \
      '' \
      '# Seed Codex config for the abc user if missing.' \
      'install -d -o abc -g abc -m 0755 /config/.codex' \
      'if [ ! -f /config/.codex/config.toml ]; then' \
      '  cp /etc/skel/.codex/config.toml /config/.codex/config.toml' \
      'fi' \
      '' \
      '# Seed desktop + autostart launchers for the abc user if missing.' \
      'install -d -o abc -g abc -m 0755 /config/Desktop /config/.config/autostart' \
      'if [ -f /etc/skel/Desktop/Nimbalyst.desktop ] && [ ! -f /config/Desktop/Nimbalyst.desktop ]; then' \
      '  cp /etc/skel/Desktop/Nimbalyst.desktop /config/Desktop/Nimbalyst.desktop' \
      '  cp /etc/skel/Desktop/Nimbalyst.desktop /config/.config/autostart/Nimbalyst.desktop' \
      'fi' \
      '' \
      '# Repair ownership so abc can read/write (fixes root-owned regressions' \
      '# from ad-hoc `docker exec nimbalyst bash` invocations).' \
      'chown -R abc:abc /config/.codex /config/Desktop /config/.config/autostart 2>/dev/null || true' \
      > /custom-cont-init.d/10-garza-llm && \
    chmod +x /custom-cont-init.d/10-garza-llm

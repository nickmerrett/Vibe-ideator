FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install build tools for native modules and beads install dependencies
RUN apk add --no-cache python3 make g++ curl go

# Install dependencies
RUN npm install

# Install beads CLI via official install script (falls back to CGO_ENABLED=0 go install
# which produces a static binary — works on Alpine without glibc shims)
RUN curl -fsSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash && \
    ln -sf /root/.local/bin/bd /usr/local/bin/bd

# Copy source code
COPY . .

# Create directories and set permissions for arbitrary UID (OpenShift)
RUN mkdir -p storage/projects storage/attachments logs && \
    chown -R 1001:0 /app && \
    chmod -R g+rwX /app

# Run as non-root user (OpenShift will override with random UID, but same group)
USER 1001

EXPOSE 3000

CMD ["npm", "start"]

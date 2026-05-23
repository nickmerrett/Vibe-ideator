FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install build tools for native modules (e.g. multer/sharp)
# libc6-compat provides glibc shims needed to run glibc-linked binaries on Alpine
RUN apk add --no-cache python3 make g++ libc6-compat

# Install dependencies
RUN npm install

# Install beads CLI
RUN npm install -g @beads/bd

# Copy source code
COPY . .

# Create directories and set permissions for arbitrary UID (OpenShift)
RUN mkdir -p storage/projects storage/attachments storage/.beads logs && \
    chown -R 1001:0 /app && \
    chmod -R g+rwX /app

# Run as non-root user (OpenShift will override with random UID, but same group)
USER 1001

EXPOSE 3000

CMD ["npm", "start"]

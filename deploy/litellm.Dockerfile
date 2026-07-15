# deploy/litellm.Dockerfile
# Build custom LiteLLM image that includes the proxy config.
#
# Build: docker build -f deploy/litellm.Dockerfile -t phus-litellm .
# Run:   docker run -p 4000:4000 --env-file .env phus-litellm
#
# Phus connects to: http://localhost:4000/v1

FROM ghcr.io/berriai/litellm:main

# Install config
COPY deploy/litellm-config.yaml /app/config/litellm-config.yaml

# Run proxy with our config
ENTRYPOINT ["litellm"]
CMD ["--config", "/app/config/litellm-config.yaml", "--port", "4000", "--host", "0.0.0.0"]

#!/bin/sh
set -e

# Wait for dependencies if needed
if [ -n "$WAIT_FOR" ]; then
  echo "Waiting for dependencies: $WAIT_FOR"
  sleep 5
fi

# Create necessary directories
mkdir -p /app/logs /app/data

# Set proper permissions
chmod 755 /app/logs /app/data

# Validate environment configuration (without logging sensitive values)
echo "Validating environment configuration..."
if [ -z "$WALLET_ADDRESS" ]; then
  echo "ERROR: WALLET_ADDRESS environment variable must be set"
  exit 1
fi

if [ -z "$WALLET_PRIVATE_KEY" ]; then
  echo "ERROR: WALLET_PRIVATE_KEY environment variable must be set"
  exit 1
fi

echo "Environment validation passed"

echo "Starting Billionaire Bot..."

# Start the application
exec "$@"
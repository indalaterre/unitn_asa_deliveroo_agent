FROM openjdk:21-slim

# Install dependencies
RUN apt-get update && \
    apt-get install -y git python3 python3-pip python3-venv curl unzip && \
    apt-get clean

# Clone ENHSP repo and compile
WORKDIR /app
RUN git clone https://gitlab.com/enricos83/ENHSP-Public.git enhsp
WORKDIR /app/enhsp
RUN chmod +x compile && ./compile

# Set up Flask server
WORKDIR /app

# Create venv and install Flask
RUN python3 -m venv /app/venv && \
    /app/venv/bin/pip install --upgrade pip && \
    /app/venv/bin/pip install Flask

COPY enhsp.py /app/enhsp.py

# Update command to use Python from the venv
ENV PATH="/app/venv/bin:$PATH"

EXPOSE 5000
CMD ["python3", "enhsp.py"]

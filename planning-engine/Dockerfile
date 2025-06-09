FROM aiplanning/planutils:latest

RUN apt-get update && apt-get install -y \
    cmake \
    g++ \
    git \
    curl \
    wget \
    flex \
    bison \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g npm

RUN pip install flask

# Create a directory for the application
WORKDIR /app

# Copy package.json and install dependencies
COPY ./package.json /app/
RUN npm install

# Copy the planner server
COPY ./planner-server.js /app/

# Install planutils tools
RUN planutils install -y enhsp

RUN planutils activate

# Expose the port for the planner server
EXPOSE 6789
# Set the entrypoint to run the Node.js planner server
CMD ["planutils", "server", "-p", "6789", "-i", "0.0.0.0"]

# BDI Deliveroo Agent

A sophisticated autonomous delivery agent built using the Belief-Desire-Intention (BDI) architecture for the DeliverooJS platform. The agent supports both reactive decision-making and PDDL-based planning, with advanced collaborative capabilities for multi-agent scenarios.

## 🏗️ Architecture

- **BDI Framework**: Belief-Desire-Intention architecture for rational decision-making
- **Reactive Mode**: Fast, heuristic-based decision making (default)
- **PDDL Planning Mode**: Classical planning using ENHSP planner (optional)
- **Multi-Agent Collaboration**: Spatial partitioning and parcel handoff strategies
- **Dynamic Environment**: Handles partially observable environments with decaying rewards

## 📋 Prerequisites

- **Node.js** (v18 or higher)
- **Docker & Docker Compose** (for DeliverooJS game servers and ENHSP planner)
- **npm** (comes with Node.js)

## 🚀 Quick Start

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/indalaterre/unitn_asa_deliveroo_agent.git
cd unitn_asa_deliveroo_agent

# Install dependencies
npm install

# Build the project
npm run build:bdi
```

### 2. Start Game Servers

```bash
# Start all DeliverooJS game servers and ENHSP planner
docker-compose up -d

# Check if services are running
docker-compose ps
```

### 3. Run Your First Agent

```bash
# Run agent on level 25c1_1 (single-agent competitive)
npm run start:25c1_1
```

## 🎮 Game Modes

### Single-Agent Competitive (25c1_x)
Two agents compete for the same parcels:
- One agent uses PDDL planning
- One agent uses reactive BDI
- Direct performance comparison

### Collaborative Multi-Agent (25c2_x)
Two agents work together:
- Information sharing and coordination
- Spatial exploration partitioning
- Parcel handoff strategies
- Combined performance optimization

## 🔧 Configuration

### Agent Configuration Files

Each level has its own configuration in `levels-configs/`:

```
levels-configs/
├── .player.env.25c1_1    # Single-agent level 1
├── .player.env.25c1_2    # Single-agent level 2
├── ...
├── .player.env.25c2_1    # Collaborative level 1
├── .player.env.25c2_2    # Collaborative level 2
├── ...
└── .player.env.25c2_hallway  # Special hallway level
```

Each configuration file contains:
```bash
HOST='http://localhost:PORT'
TOKEN='JWT_TOKEN_FOR_AUTHENTICATION'
```

### Available Levels

#### Single-Agent Competitive Levels
- `25c1_1` through `25c1_6` - Standard competitive levels
- `25c1_7`, `25c1_8`, `25c1_9` - Additional test levels

#### Collaborative Levels
- `25c2_1` through `25c2_7` - Multi-agent collaboration levels
- `25c2_hallway` - Special corridor-based level

## 🎯 Running Different Configurations

### Single Commands

#### Reactive BDI Mode (Default)
```bash
# Single-agent levels
npm run start:25c1_1
npm run start:25c1_2
npm run start:25c1_3
npm run start:25c1_4
npm run start:25c1_5
npm run start:25c1_6

# Collaborative levels
npm run start:25c2_1
npm run start:25c2_2
npm run start:25c2_3
npm run start:25c2_4
npm run start:25c2_5
npm run start:25c2_6
npm run start:25c2_7
npm run start:25c2_hallway
```

#### PDDL Planning Mode
```bash
# Single-agent levels with PDDL planning
npm run start:25c1_1:pddl
npm run start:25c1_2:pddl
npm run start:25c1_3:pddl
npm run start:25c1_4:pddl
npm run start:25c1_5:pddl
npm run start:25c1_6:pddl

# Collaborative levels with PDDL planning
npm run start:25c2_1:pddl
npm run start:25c2_2:pddl
npm run start:25c2_3:pddl
npm run start:25c2_4:pddl
npm run start:25c2_5:pddl
npm run start:25c2_6:pddl
npm run start:25c2_7:pddl
npm run start:25c2_hallway:pddl
```

### Running Multiple Agents

For collaborative scenarios, you need to run two agents simultaneously:

```bash
# Example 1: Both agents using reactive BDI
# Terminal 1: Start first agent (reactive BDI)
npm run start:25c2_1

# Terminal 2: Start second agent (reactive BDI)
npm run start:25c2_1

# Example 2: Mixed mode (one reactive, one PDDL)
# Terminal 1: Start first agent (reactive BDI)
npm run start:25c2_1

# Terminal 2: Start second agent (PDDL planning)
npm run start:25c2_1:pddl

# Example 3: Both agents using PDDL planning
# Terminal 1: Start first agent (PDDL)
npm run start:25c2_1:pddl

# Terminal 2: Start second agent (PDDL)
npm run start:25c2_1:pddl
```

### Competitive Single-Agent Setup

For single-agent competitive levels, run both agents simultaneously:

```bash
# Terminal 1: Reactive BDI agent
npm run start:25c1_1

# Terminal 2: PDDL planning agent
npm run start:25c1_1:pddl
```

### Custom Agent Names

You can also run agents with custom configurations:

```bash
# Reactive BDI mode
npm run build:bdi && node dist/main-bdi.js --agent-name=YOUR_AGENT_NAME

# PDDL planning mode
npm run build:bdi && node dist/main-bdi.js --agent-name=YOUR_AGENT_NAME --use_pddl=true
```

## 🐳 Docker Services

The `docker-compose.yaml` file provides:

### Game Servers
- **25c1_1** - Port 4003 (Single-agent level 1)
- **25c1_2** - Port 4004 (Single-agent level 2)
- **...** - Ports 4005-4008 (Additional single-agent levels)
- **25c2_1** - Port 4012 (Collaborative level 1)
- **25c2_2** - Port 4013 (Collaborative level 2)
- **...** - Ports 4014-4018 (Additional collaborative levels)
- **25c2_hallway** - Port 4099 (Special hallway level)

### Planning Service
- **ENHSP Planner** - Port 6790 (PDDL planning service)

### Managing Docker Services

```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# View logs
docker-compose logs

# Restart specific service
docker-compose restart 25c1_1

# Check service status
docker-compose ps
```

## 🧠 Agent Features

### BDI Architecture
- **Beliefs**: World state, parcel locations, agent positions
- **Desires**: Goals like pickup, delivery, exploration
- **Intentions**: Committed plans with execution strategies

### Planning Modes
- **Reactive BDI** (Default): Fast heuristic-based decisions
- **PDDL Planning**: Optimal long-term planning using ENHSP

### Collaborative Features
- **Spatial Partitioning**: Divide exploration areas
- **Parcel Handoff**: Transfer parcels between agents
- **Information Sharing**: Communicate discoveries
- **Conflict Avoidance**: Coordinate to prevent competition

## 📊 Performance Monitoring

The agent includes built-in statistics logging:
- Parcels delivered
- Total score achieved
- Average score per parcel

## 🔍 Debugging

### Enable Debug Logging
Uncomment debug statements in the code for detailed execution traces:
```typescript
// console.log(`Current intention: ${this.currentIntention.toString()}`);
```

### Common Issues

1. **Agent Hangs**: Check socket timeouts in `SocketClient`
2. **Planning Failures**: Verify ENHSP service is running on port 6790
3. **Connection Issues**: Ensure Docker services are up and tokens are valid
4. **Path Finding**: Check for blocked routes or infinite loops

## 🧪 Experimental Setup

### Benchmarking
Run experiments across multiple levels to compare:
- Reactive BDI vs PDDL performance
- Single-agent vs collaborative efficiency
- Different level complexities

### Data Collection
Each run provides:
- Total score achieved
- Number of parcels delivered
- Average score per parcel
- Execution time and resource usage

## 📝 Development

### Project Structure
```
src/
├── domain/
│   ├── beliefs.ts           # Belief management
│   ├── desires/             # Desire generation
│   ├── intentions/          # Intention execution
│   ├── communication/       # Agent messaging
│   └── models/              # Data structures
├── utils/
│   └── planning-manager.ts  # PDDL planning interface
└── main-bdi.ts             # Entry point
```

### Building
```bash
# Build for development
npm run build:bdi

# Lint code
npm run lint

# Fix linting issues
npm run lint-fix
```

## 📚 Academic Paper

This implementation is documented in the accompanying academic paper:
- **Title**: "A BDI Agent for Pickup-and-Delivery Tasks in Dynamic Environments"
- **Authors**: Mauro Antonio de Palma, Marco Crespi
- **Institution**: University of Trento

## 🆘 Support

For issues and questions:
- Review Docker service logs: `docker-compose logs`
- Verify configuration files in `levels-configs/`
- Ensure all dependencies are installed

## 🎯 Quick Reference

| Command | Description |
|---------|-------------|
| `npm run build:bdi` | Build the agent |
| `docker-compose up -d` | Start game servers |
| `npm run start:25c1_1` | Run single-agent level 1 (reactive BDI) |
| `npm run start:25c1_1:pddl` | Run single-agent level 1 (PDDL planning) |
| `npm run start:25c2_1` | Run collaborative level 1 (reactive BDI) |
| `npm run start:25c2_1:pddl` | Run collaborative level 1 (PDDL planning) |
| `docker-compose down` | Stop all servers |
| `npm run lint` | Check code quality |

### Planning Mode Comparison

| Mode | Command Suffix | Description | Performance |
|------|----------------|-------------|-------------|
| **Reactive BDI** | (none) | Fast heuristic decisions | ~47% better score, ~31% more parcels |
| **PDDL Planning** | `:pddl` | Optimal long-term planning | Higher CPU usage (~300%), slower decisions |

### Experimental Setup Examples

```bash
# Competitive comparison (single-agent)
npm run start:25c1_1        # Terminal 1: Reactive BDI
npm run start:25c1_1:pddl   # Terminal 2: PDDL Planning

# Collaborative teamwork (multi-agent)
npm run start:25c2_1        # Terminal 1: Reactive BDI
npm run start:25c2_1:pddl   # Terminal 2: PDDL Planning
```

## 🎯 Happy Delivering! 🚚📦

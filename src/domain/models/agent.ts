import type { Position } from "@domain/models/environment";
import { IdAware } from "@domain/models/id-aware";
import { Instant } from "@domain/models/time";

export class Agent extends IdAware {
    constructor(
        public readonly agentId: string,
        public position: Position,
        public score: number,
        public instantiationTime?: number,
    ) {
        super(agentId);
    }

    /**
     * TRUE if the two agents are identical
     * @param other the other agent to compare
     */
    equals(other: Agent): boolean {
        let equal = false;

        if (other instanceof Agent && super.equals(other) && this.position.equals(other.position)) {
            equal = true;
        }

        return equal;
    }
}

export class ObservedAgent extends IdAware {
    /**
     * The position of the agent
     */
    public position: Position;

    constructor(
        public readonly agentId: string,
        public score = 0,
        public lastSeen: Instant = Instant.now(),
    ) {
        super(agentId);
    }

    /**
     * Creates an ObservedAgent from an Agent
     * @param agent The agent to observe
     * @returns A new ObservedAgent
     */
    static fromAgent(agent: Agent): ObservedAgent {
        const observedAgent = new ObservedAgent(agent.agentId, agent.score, Instant.now());
        observedAgent.position = agent.position;
        return observedAgent;
    }

    /**
     * Checks if the agent observation has expired
     * @param maxAge The maximum age in milliseconds
     * @returns True if the agent observation has expired
     */
    isExpired(maxAge = 5000): boolean {
        return Instant.now().subtract(this.lastSeen).seconds > maxAge;
    }

    isFriendExpired(): boolean {
        return this.isExpired(10000);
    }

    toAgent(): Agent {
        return new Agent(this.agentId, this.position, this.score);
    }

    /**
     * TRUE if the two agents are identical
     * @param other the other agent to compare
     */
    equals(other: Agent): boolean {
        let equal = false;

        if (other instanceof Agent && super.equals(other)) {
            equal = true;
        }

        return equal;
    }

    ping(): void {
        this.lastSeen = Instant.now();
    }
}

import type { Position } from "@domain/models/environment";
import { IdAware } from "@domain/models/id-aware";
import { Instant } from "@domain/models/time";

export class Agent extends IdAware {
    constructor(
        public readonly agentId: string,
        public position: Position,
        public score: number,
    ) {
        super(agentId);
    }

    /**
     * TRUE if the two agents are identical
     * @param other the other agent to compare
     */
    equals(other: Agent): boolean {

        let equal = false;

        if ((other instanceof Agent) && 
            super.equals(other) &&
            this.position.equals(other.position))
        {
            equal = true;
        }

        return equal;
    }
}

export class ObservedAgent extends IdAware {
    constructor(
        public readonly agentId: string,
        public score: number,
        public lastSeen: Instant
    ) {
        super(agentId);
    }

    /**
     * TRUE if the two agents are identical
     * @param other the other agent to compare
     */
    equals(other: Agent): boolean {

        let equal = false;

        if ((other instanceof Agent) && super.equals(other)){
            equal = true;
        }

        return equal;
    }
}

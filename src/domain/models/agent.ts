import type { Position } from "@domain/models/environment";
import { IdAware } from "@domain/models/id-aware";

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
        if (!(other instanceof Agent)) return false;

        const idEqual = super.equals(other);
        return idEqual && this.position.equals(other.position);
    }
}

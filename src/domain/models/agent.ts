import type { Position } from "@domain/models/environment";

export class Agent {
    constructor(
        private readonly agentId: string,
        private position: Position,
        private score: number,
    ) {}
}

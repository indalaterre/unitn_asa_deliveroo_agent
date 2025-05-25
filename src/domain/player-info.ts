import type { Position } from "@domain/models/environment";
import type { IdAware } from "@domain/models/id-aware";

/**
 * Models the player information (id and position)
 */
export class PlayerInfo {
    private readonly instantiationTime: Date = new Date();

    constructor(
        public readonly id: IdAware,
        public readonly name: string,
        public position: Position,
    ) {}

    get instantiatedAt(): number {
        return this.instantiationTime.getTime();
    }
}

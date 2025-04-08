import type { Position } from "@domain/models/environment";
import type { Hashable } from "@utils/interfaces";

export enum IntentionTypes {
    MOVE = 0,
    PICK_UP = 1,
    PUT_DOWN = 2,
}

export class Intention implements Hashable {
    constructor(
        readonly type: IntentionTypes,
        readonly position: Position,
    ) {}

    /**
     * Generates a MOVE intention for the position
     * @param position
     */
    static move(position: Position): Intention {
        return new Intention(IntentionTypes.MOVE, position);
    }

    /**
     * Generates a PICK_UP intention for the position
     * @param position
     */
    static pickUp(position: Position): Intention {
        return new Intention(IntentionTypes.PICK_UP, position);
    }

    /**
     * Generates a PUT_DOWN intention for the position
     * @param position
     */
    static putDown(position: Position): Intention {
        return new Intention(IntentionTypes.PUT_DOWN, position);
    }

    /**
     * Equals method
     * @param other
     */
    equals(other: Intention): boolean {
        return this.type === other.type && this.position?.equals(other?.position);
    }

    /**
     * HashCode method
     */
    hashCode(): string {
        return `${IntentionTypes[this.type]}-${this.position.hashCode()}`;
    }

    /**
     * ToString method
     */
    toString(): string {
        return `${IntentionTypes[this.type]} - [${this.position.toString()}]`;
    }
}

import type { Position } from "@domain/models/environment";
import type { Hashable } from "@utils/interfaces";

export enum IntentionTypes {
    MOVE = 0,
    PICK_UP = 1,
    PUT_DOWN = 2,

    EXPLORE = 3,
    DELIVER = 4,
}

export class Intention implements Hashable {
    static readonly MOVING_INTENTIONS: IntentionTypes[] = [
        IntentionTypes.MOVE,
        IntentionTypes.EXPLORE,
        IntentionTypes.DELIVER,
    ];

    constructor(
        readonly type: IntentionTypes,
        readonly position: Position,
        public _context?: any,
    ) {}

    /**
     * Generates a MOVE intention for the position
     * @param position  the destination position
     * @param isDelivering   TRUE if the agent is going to deliver a parcel
     */
    static move(position: Position, isDelivering = false): Intention {
        return new Intention(IntentionTypes.MOVE, position, { isDelivering });
    }

    /**
     * Generates a DELIVER intention for the position
     * @param position
     */
    static deliver(position: Position): Intention {
        return new Intention(IntentionTypes.DELIVER, position);
    }

    /**
     * Generates an EXPLORE intention for the position
     * @param position
     */
    static explore(position: Position): Intention {
        return new Intention(IntentionTypes.EXPLORE, position);
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

    get context(): any {
        return this._context;
    }

    set context(value: any) {
        this._context = value;
    }
}

import type { Position } from "@domain/models/environment";
import { AbstractHashable } from "@utils/abstract-hashable";
import type { Hashable } from "@utils/interfaces";

export enum IntentionTypes {
    MOVE = 0,
    PICK_UP = 1,
    PUT_DOWN = 2,

    EXPLORE = 3,
    DELIVER = 4,
}

export class Intention extends AbstractHashable implements Hashable {
    static readonly MOVING_INTENTIONS: IntentionTypes[] = [
        IntentionTypes.MOVE,
        IntentionTypes.EXPLORE,
        IntentionTypes.DELIVER,
    ];

    private readonly MAX_ALLOWED_FAILURES: number = 2;

    /**
     * The number of consecutive failures
     * @private
     */
    private _failures = 0;

    constructor(
        readonly type: IntentionTypes,
        readonly position: Position,
        public _context?: any,
    ) {
        super();
    }

    /**
     * Generates a MOVE intention for the position
     * @param position  the destination position
     */
    static move(position: Position): Intention {
        return new Intention(IntentionTypes.MOVE, position);
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
    protected hashString(): string {
        return `${IntentionTypes[this.type]}-${this.position.hashCode()}-${JSON.stringify(this.context)}`;
    }

    /**
     * ToString method
     */
    toString(): string {
        return `${IntentionTypes[this.type]} - [${this.position.toString()}]`;
    }

    addFailure(): void {
        this._failures++;
    }

    shouldGiveUp(): boolean {
        return this.type !== IntentionTypes.EXPLORE && this._failures >= this.MAX_ALLOWED_FAILURES;
    }

    get context(): any {
        return this._context;
    }

    set context(value: any) {
        this._context = value;
    }
}

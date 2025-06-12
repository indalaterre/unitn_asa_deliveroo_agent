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

    readonly MAX_ALLOWED_FAILURES: number = 2;

    /**
     * The number of consecutive failures
     * @private
     */
    private _failures = 0;

    /**
     * Only used to improve debugging
     * @private
     */
    private readonly _serializedType: string;

    constructor(
        public type: IntentionTypes,
        public position: Position,
        public subIntentions: Intention[] = [],
        public _context?: any,
    ) {
        super();
        this._serializedType = IntentionTypes[type];
    }

    /**
     * Generates a MOVE intention for the position
     * @param position  the destination position
     */
    static move(position: Position): Intention {
        return new Intention(IntentionTypes.MOVE, position, [Intention.pickUp(position)]);
    }

    /**
     * Generates a DELIVER intention for the position
     * @param position
     */
    static deliver(position: Position): Intention {
        return new Intention(IntentionTypes.DELIVER, position, [Intention.putDown(position)]);
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

    /**
     * Returns the current number of consecutive failures
     */
    getFailureCount(): number {
        return this._failures;
    }

    /**
     * Resets the failure counter to zero
     */
    resetFailures(): void {
        this._failures = 0;
    }

    /**
     * Checks if the intention has failed at least once
     */
    hasFailed(): boolean {
        return this._failures > 0;
    }

    shouldGiveUp(): boolean {
        return this._failures >= this.MAX_ALLOWED_FAILURES;
    }

    get context(): any {
        return this._context;
    }

    set context(value: any) {
        this._context = value;
        this.subIntentions.forEach((intention: Intention) => (intention.context = value));
    }

    /**
     * Checks if this intention has context information
     * @returns True if the intention has context
     */
    hasContext(): boolean {
        return !!this._context;
    }

    /**
     * Move the intention ahead promoting the first subintention as the main one
     * @returns TRUE if there was a promotion. FALSE otherwise
     */
    promote(): boolean {
        if (!this.subIntentions?.length) {
            return false;
        }

        const subIntention: Intention = this.subIntentions.shift();

        this.type = subIntention.type;
        this.context = subIntention.context;
        this.position = subIntention.position;
        this.subIntentions = subIntention.subIntentions;

        return true;
    }

    /**
     * TRUE if it's a pickup intention
     */
    get isPickup(): boolean {
        return this.type === IntentionTypes.PICK_UP;
    }

    get isExplore(): boolean {
        return this.type === IntentionTypes.EXPLORE;
    }
}

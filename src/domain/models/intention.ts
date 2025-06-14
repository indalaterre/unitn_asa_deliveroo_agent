import type { Position } from "@domain/models/environment";
import { AbstractHashable } from "@utils/abstract-hashable";
import type { Hashable } from "@utils/interfaces";

export enum IntentionTypes {
    PICKUP_HANDOFF = -1,
    PUT_DOWN_HANDOFF = -2,

    MOVE = 0,
    PICK_UP = 1,
    PUT_DOWN = 2,

    EXPLORE = 3,
    DELIVER = 4,

    WAIT = 99,
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

    constructor(
        public type: IntentionTypes,
        public position: Position,
        public subIntentions: Intention[] = [],
        public _context?: any,
    ) {
        super();
    }

    /**
     * Only used to improve debugging
     */
    get serializedType(): string {
        return IntentionTypes[this.type];
    }

    /**
     * Generates a MOVE intention for the position
     * @param position  the destination position
     */
    static move(position: Position): Intention {
        return new Intention(IntentionTypes.MOVE, position, [Intention.pickUp(position)]);
    }

    /**
     * Generates a MOVE intention to pick up the parcel of the friend agent
     * @param position  the meeting position with the friend agent
     */
    static moveHandOff(position: Position): Intention {
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
     * Generates a DELIVER intention for the position including the handoff communication
     * @param position  the meeting position with the friend agent
     * @param friendId  the id of the friend agent
     * @param benefit   the benefit from the handoff (used to calculate the urgency for the friend agent)
     */
    static deliverHandoff(position: Position, friendId: string, benefit: number): Intention {
        return new Intention(
            IntentionTypes.PICKUP_HANDOFF,
            position,
            [Intention.deliver(position), Intention.putDown(position)],
            { friendId, benefit },
        );
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
     * Generates a WAIT intention with a condition to stop waiting
     * @param stopWaitingCondition  the "stop waiting" condition
     */
    static wait(stopWaitingCondition: (data: any) => boolean): Intention {
        return new Intention(IntentionTypes.WAIT, null, [], { stopWaitingCondition });
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
        return `${IntentionTypes[this.type]}-${this.position?.hashCode()}-${JSON.stringify(this.context)}`;
    }

    /**
     * ToString method
     */
    toString(): string {
        return `${IntentionTypes[this.type]} - [${this.position?.toString()}]`;
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
        this._context = {
            ...this._context,
            ...value,
        };

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
     * Updates the position on which the intention will be executed
     * @param position  the new position
     * @param subTypes  the list of types to which the update must be propagated
     */
    updatePosition(position: Position, subTypes: IntentionTypes[] = []): void {
        if (!position) return;

        this.position = position;
        for (const subIntention of this.subIntentions) {
            if (!subTypes.includes(subIntention.type)) continue;

            subIntention.updatePosition(position, subTypes);
        }
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
        this.position = subIntention.position;
        this.subIntentions = subIntention.subIntentions;
        this.context = { ...this.context, ...subIntention.context };

        return true;
    }

    /**
     * TRUE if it's a DELIVER intention
     */
    get isDeliver(): boolean {
        return this.type === IntentionTypes.DELIVER;
    }

    /**
     * TRUE if it's an EXPLORE intention
     */
    get isExplore(): boolean {
        return this.type === IntentionTypes.EXPLORE;
    }
}

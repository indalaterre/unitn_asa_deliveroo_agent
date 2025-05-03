import { GameConfiguration } from "@domain/models/configurations";
import { type Duration, Instant } from "@domain/models/time";

/**
 * Models a class whose value is decaying over time with a certain decaying factor
 */
export class DecayingValue {
    /**
     * @private Current value
     */
    private readonly _value: number;

    /**
     * @private The decaying factor
     */
    private readonly _factor: number;

    /**
     * @private The instant value has been created
     */
    private readonly _instant: Instant;

    /**
     *
     * @param value     the current parcel value
     * @param instant   the instant (default now)
     * @param factor    the decay factor (default 1)
     */
    constructor(value: number, instant: Instant = Instant.now(), factor = 1) {
        this._value = value;
        this._factor = factor;
        this._instant = instant;
    }

    /**
     * Compute the value at the given instance of time.
     *
     * @param instant The instance to compute the value at.
     * @returns The value.
     */
    public getValueByInstant(instant: Instant): number {
        const diff: Duration = instant.subtract(this._instant);

        const decayingInterval: Duration = GameConfiguration.parcelDecayingInterval;
        const value: number = this._value - diff.seconds / decayingInterval.seconds;
        return Math.max(0, Math.floor(value));
    }

    /**
     * Compute the value at current time
     * @returns The value.
     */
    public getCurrentValue(): number {
        return this.getValueByInstant(Instant.now());
    }
}

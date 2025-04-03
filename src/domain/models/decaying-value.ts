import { Instant } from "@domain/models/time";

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
        const diff = instant.subtract(this._instant);

        //TODO: Implement by configuration
        //const { parcelDecayingInterval } = Config.getEnvironmentConfig();
        //const value = this._value - diff.milliseconds / parcelDecayingInterval.milliseconds;
        const value = this._value - diff.milliseconds / 1000;
        return value < 0 ? 0 : value;
    }

    /**
     * Compute the value at current time
     * @returns The value.
     */
    public getCurrentValue(): number {
        return this.getValueByInstant(Instant.now());
    }
}

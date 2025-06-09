/**
 * Wraps the logic to manage time
 */
export class Instant {
    private constructor(private readonly _value: number) {}

    /**
     * @returns the instant related to the current time
     */
    static now(): Instant {
        return new Instant(Date.now());
    }

    /**
     * @returns the time in milliseconds from epoch
     */
    get milliseconds(): number {
        return this._value;
    }

    /**
     * Subtract the given instant from the current one
     * @param instant
     */
    subtract(instant: Instant): Duration {
        return Duration.fromMilliseconds(this.milliseconds - instant.milliseconds);
    }
}

/**
 * Models the duration given by time differences
 */
export class Duration {
    private constructor(
        private readonly _value: number,
        private readonly _isInfinite: boolean,
    ) {}

    /**
     * TRUE if the duration is infinite
     */
    get isInfinite(): boolean {
        return this._isInfinite;
    }

    /**
     * @returns the time difference in milliseconds
     */
    get milliseconds(): number {
        return this._value;
    }

    /**
     * @returns the time difference in seconds
     */
    get seconds(): number {
        return this._value / 1000;
    }

    /**
     * Creates an instance from a seconds amount
     * @param seconds  the duration in seconds
     * @param isInfinite    TRUE if the duration is infinite
     */
    static fromSeconds(seconds: number, isInfinite = false): Duration {
        return new Duration(seconds * 1000, isInfinite);
    }

    /**
     * Creates an instance from a milliseconds amount
     * @param milliseconds  the duration in milliseconds
     * @param isInfinite    TRUE if the duration is infinite
     */
    static fromMilliseconds(milliseconds: number, isInfinite = false): Duration {
        return new Duration(milliseconds, isInfinite);
    }
}

/**
 * Class for tracking and logging agent delivery statistics
 * Uses a single-line update approach to avoid cluttering the console
 */
export class StatisticsLogger {
    private _totalParcelsDelivered: number = 0;
    private _totalPointsEarned: number = 0;
    private _lastLogTime: number = Date.now();
    private _logIntervalMs: number = 5000; // Log every 5 seconds
    private _isFirstLog: boolean = true;
    private _lineId: string = "stats-line-" + Math.random().toString(36).substring(2, 9);
    
    /**
     * Records a successful parcel delivery
     * @param parcelIds Array of parcel IDs that were delivered
     * @param pointsEarned Points earned from this delivery
     */
    public recordDelivery(parcelIds: string[], pointsEarned: number): void {
        this._totalParcelsDelivered += parcelIds.length;
        this._totalPointsEarned += pointsEarned;
        
        // Check if it's time to log statistics
        this._logStatisticsIfNeeded();
    }
    
    /**
     * Forces logging of current statistics
     * Uses process.stdout to update a single line instead of creating new lines
     */
    public logStatistics(): void {
        const avgPointsPerParcel = this._totalParcelsDelivered > 0 
            ? (this._totalPointsEarned / this._totalParcelsDelivered).toFixed(2) 
            : "0.00";
            
        // Create a clean single-line output with statistics
        /*
        const statsLine = 
            `\r📊 STATS: Parcels Delivered: ${this._totalParcelsDelivered} | ` +
            `Avg Points/Parcel: ${avgPointsPerParcel} | ` +
            `Total Points: ${this._totalPointsEarned}`;
        */
        // Write to stdout without a newline to update the same line
        //process.stdout.write(statsLine);
        
        this._lastLogTime = Date.now();
        this._isFirstLog = false;
    }
    
    /**
     * Logs final statistics with a newline
     * Use this when the agent is stopping
     */
    public logFinalStatistics(): void {
        const avgPointsPerParcel = this._totalParcelsDelivered > 0 
            ? (this._totalPointsEarned / this._totalParcelsDelivered).toFixed(2) 
            : "0.00";
            
        // Create a clean output with statistics and add a newline
        console.log(
            `\r📊 FINAL STATS: Parcels Delivered: ${this._totalParcelsDelivered} | ` +
            `Avg Points/Parcel: ${avgPointsPerParcel} | ` +
            `Total Points: ${this._totalPointsEarned}`
        );
    }
    
    /**
     * Logs statistics if the logging interval has elapsed
     * @private
     */
    private _logStatisticsIfNeeded(): void {
        const now = Date.now();
        if (now - this._lastLogTime >= this._logIntervalMs) {
            this.logStatistics();
        }
    }
    
    /**
     * Gets the total number of parcels delivered
     */
    public get totalParcelsDelivered(): number {
        return this._totalParcelsDelivered;
    }
    
    /**
     * Gets the total points earned
     */
    public get totalPointsEarned(): number {
        return this._totalPointsEarned;
    }
    
    /**
     * Gets the average points per parcel
     */
    public get avgPointsPerParcel(): number {
        return this._totalParcelsDelivered > 0 
            ? this._totalPointsEarned / this._totalParcelsDelivered 
            : 0;
    }
}

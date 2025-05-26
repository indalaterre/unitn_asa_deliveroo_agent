import { BeliefContainer } from "./beliefs";
import type { Actuator } from "./communication";
import { MessageFactory } from "./communication/message-factory";
import type { Messenger } from "./communication/messenger";
import type { Sensor } from "./communication/sensor";
import { DesiresManager } from "./desires";
import { IntentionManager } from "./intentions";
import type { MatchMap } from "./map";
import type { Parcel } from "./models";
import type { Agent } from "./models/agent";
import type { Directions, Position } from "./models/environment";
import { HandoffCoordinator, type HandoffRequest } from "./models/handoff-coordinator";
import { StatisticsLogger } from "./models/statistics-logger";
import type { PlayerInfo } from "./player-info";

/**
 * The main player class using BDI architecture
 * (Beliefs, Desires, Intentions)
 */
export class PlayerBDI {
    /**
     * TRUE if the player is alive and able to play
     */
    private _isAlive = false;

    /**
     * The handle of the statistics logging interval
     * @private
     */
    private _statsInterval: any;

    /**
     * The handle of the hello sending interval
     * @private
     */
    private _helloSendingInterval: any;

    /**
     * Contains all the beliefs of the agent
     */
    private readonly _beliefs: BeliefContainer;

    /**
     * Manages the agent's desires
     */
    private readonly _desiresManager: DesiresManager;

    /**
     * Manages the agent's intentions
     */
    private readonly _intentionManager: IntentionManager;

    /**
     * Logger for tracking delivery statistics
     * @private
     */
    private _statsLogger: StatisticsLogger = new StatisticsLogger();

    /**
     * Coordinator for parcel handoffs between agents
     * @private
     */
    private readonly _handoffCoordinator: HandoffCoordinator;

    /**
     * Creates a new player with BDI architecture
     */
    public constructor(
        matchMap: MatchMap,
        sensor: Sensor,
        private readonly actuator: Actuator,
        private readonly messenger: Messenger,
        private readonly playerInfo: PlayerInfo,
    ) {
        // Initialize belief system
        this._beliefs = new BeliefContainer(playerInfo, matchMap);

        // Initialize handoff coordinator
        this._handoffCoordinator = new HandoffCoordinator(
            this.messenger,
            this._beliefs
        );

        // Initialize desires manager
        this._desiresManager = new DesiresManager(this._beliefs, this._handoffCoordinator);

        // Initialize intention manager
        this._intentionManager = new IntentionManager(
            this.actuator,
            this._beliefs,
            this._statsLogger,
            this._desiresManager,
            this._handoffCoordinator,
        );

        // Set up sensor handlers
        this.setupSensorHandlers(sensor);

        // Set up messenger handlers
        this.setupMessengerHandlers();
    }

    /**
     * Sets up handlers for sensor events
     * @param sensor The sensor to listen to
     * @private
     */
    private setupSensorHandlers(sensor: Sensor): void {
        // Handle position updates
        sensor.onPlayerPositionUpdate((position: Position) => {
            this.updatePlayerPosition(position);
        });

        // Handle agent sensing
        sensor.onAgentSensing(async (agents: Agent[]) => {
            this._beliefs.queueAgentsSynchronization(agents);

            // Share agent information with other agents
            await this.messenger.shoutAgentsInfo(
                MessageFactory.createAgentsUpdateMessage(this.playerInfo.id.toString(), agents),
            );
        });

        // Handle parcel detection
        sensor.onParcelDetected(async (parcels: Parcel[]) => {
            this._beliefs.queueParcelsSynchronization(parcels);

            // Share parcel information with other agents
            await this.messenger.shoutParcelInfo(
                MessageFactory.createParcelInfoMessage(this.playerInfo.id.toString(), parcels),
            );
        });
    }

    /**
     * Sets up handlers for messenger events
     * @private
     */
    private setupMessengerHandlers(): void {
        // Handle agent information
        this.messenger.onAgentsInfoReceived((agents: Agent[]) => {
            this._beliefs.queueAgentsSynchronization(agents);
        });

        // Handle parcel information
        this.messenger.onParcelInfoReceived((parcels: Parcel[]) => {
            this._beliefs.queueParcelsSynchronization(parcels);
        });

        // Handle hello messages
        this.messenger.onHelloMessageReceived(async (agent: Agent) => {
            this._beliefs.addTrustedAgent(agent.agentId);
            this._beliefs.queueAgentsSynchronization([agent]);

            // Reply with our own hello message
            const helloMessage = MessageFactory.createHelloMessage(
                this.playerInfo.id.toString(),
                this._beliefs.myPosition,
                this._beliefs.myScore,
                agent.agentId,
            );

            await this.messenger.replyHelloMessage(helloMessage);
        });

        // Additional handlers for handoff messages would be added here
    }

    /**
     * Updates the player's position
     * @param position The new position
     */
    private updatePlayerPosition(position: Position): void {
        this._beliefs.myPosition = position;
    }

    /**
     * Starts the player
     */
    async start(): Promise<void> {
        this._isAlive = true;

        // Set up interval to log statistics periodically
        this._statsInterval = setInterval(() => {
            this._statsLogger.logStatistics();
        }, 10000); // Log every 10 seconds

        // Set up interval to send hello messages
        this._helloSendingInterval = setInterval(async () => {
            await this.shoutHelloMessage();
        }, 1000);

        // Start the main loop
        await Promise.all([this.shoutHelloMessage(), this._run()]);
    }

    /**
     * Stops the player
     */
    stop(): void {
        this._isAlive = false;

        this._statsInterval && clearInterval(this._statsInterval);
        this._helloSendingInterval && clearInterval(this._helloSendingInterval);

        // Log final statistics when stopping
        console.log("\n"); // Add a newline before final stats
        this._statsLogger.logFinalStatistics();
        console.log(""); // Add a newline after final stats
    }

    /**
     * Sends a hello message to all agents
     * @private
     */
    private async shoutHelloMessage(): Promise<void> {
        const helloMessage = MessageFactory.createHelloMessage(
            this.playerInfo.id.toString(),
            this._beliefs.myPosition,
            this._beliefs.myScore,
        );

        await this.messenger.shoutHelloMessage(helloMessage);
    }

    /**
     * Main execution loop
     * @private
     */
    private async _run(): Promise<void> {
        while (this._isAlive) {
            await new Promise((resolve) => setImmediate(resolve));

            //if (this.playerInfo.name === "Amico2") {
            //    continue;
            //}

            // Synchronize beliefs
            this._beliefs.synchronizeKnownAgents();
            this._beliefs.synchronizeKnownParcels();

            // Generate desires based on current beliefs
            this._desiresManager.generateDesires();

            // Process intentions
            await this._intentionManager.processIntentions();
        }
    }

    /**
     * Executes a handoff
     * @returns Promise that resolves to true if the handoff was executed, false otherwise
     * @private
     */
    private async executeHandoff(): Promise<boolean> {
        const handoff: HandoffRequest = this._handoffCoordinator.getActiveHandoff();
        if (!handoff) {
            return false;
        }

        // Check if we're at the meeting position
        const atMeetingPosition: boolean = this._beliefs.myPosition.equals(handoff.meetingPosition);

        if (!atMeetingPosition) {
            const nextPosition: Position = handoff.meetingPath.shift();
            const nextDirection: Directions = this._beliefs.myPosition.getDirection(nextPosition);
            // Move towards meeting position
            const success = await this.actuator.move(nextDirection);
            return false; // Not complete yet
        }

        // Check if this is an incoming or outgoing handoff
        const isIncoming = handoff.receiverId === this.playerInfo.id.toString();

        if (isIncoming) {
            // We're receiving parcels
            // Wait for the initiator to put down the parcels
            return false; // Not complete yet
        } else {
            // We're giving parcels
            // Put down the parcels
            const success: Set<string> = await this.actuator.putDown(handoff.parcelIds);

            if (success) {
                // Complete the handoff
                this._handoffCoordinator.completeHandoff(handoff.requestId, true);
                return true;
            } else {
                // Handoff failed
                this._handoffCoordinator.completeHandoff(handoff.requestId, false);
                return false;
            }
        }
    }
}

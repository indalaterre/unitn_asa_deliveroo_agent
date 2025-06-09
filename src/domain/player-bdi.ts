import type { ClusteredTiles } from "@utils/clustering-worker";
import { InternalEventManager } from "@utils/internal-event-manager";
import { BeliefContainer } from "./beliefs";
import type { Actuator } from "./communication";
import { MessageFactory } from "./communication/message-factory";
import type { HelloMessage, Messenger } from "./communication/messenger";
import type { Sensor } from "./communication/sensor";
import { DesiresManager } from "./desires";
import { IntentionManager } from "./intentions";
import type { MatchMap } from "./map";
import { type Duration, GameConfiguration, type Parcel } from "./models";
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
     * TRUE if the clustering of the map is active
     * @private
     */
    private _canRecalculateMapSectors = false;

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

        // Initialize desires manager
        this._desiresManager = new DesiresManager(this._beliefs);

        // Initialize handoff coordinator
        this._handoffCoordinator = new HandoffCoordinator(
            this.messenger,
            this._beliefs,
            this._desiresManager,
        );

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

        //Waiting 10 seconds before starting the exploration partitioning
        //This would let other friend agents to join
        setTimeout(async () => {
            if (!this._beliefs.isTheMaster) return;

            this._canRecalculateMapSectors = true;
            await this.assignExplorationSectors();
        }, 4000);
    }

    /**
     * Starts the player
     */
    async start(): Promise<void> {
        this._isAlive = true;

        const agentTimeout: Duration = GameConfiguration.agentTimeout;

        // Set up interval to log statistics periodically
        setInterval(() => {
            this._statsLogger.logStatistics();
        }, 10000); // Log every 10 seconds

        // Set up interval to send hello messages
        setInterval(async () => {
            await this.shoutHelloMessage();
        }, agentTimeout.milliseconds + 1000);

        InternalEventManager.on("parcels:synchronized", async () => {
            await this._desiresManager.generateDesires();
        });

        // Start the main loop
        await Promise.all([this.shoutHelloMessage(), this._run()]);
    }

    /**
     * Sets up handlers for sensor events
     * @param sensor The sensor to listen to
     * @private
     */
    private setupSensorHandlers(sensor: Sensor): void {
        // Handle agent sensing
        sensor.onAgentSensing(async (agents: Agent[]) => {
            this._beliefs.queueAgentsSynchronization(agents);
        });

        // Handle parcel detection
        sensor.onParcelDetected(async (parcels: Parcel[]) => {
            this._beliefs.queueParcelsSynchronization(parcels);
        });

        setInterval(async () => {
            if (this._beliefs.trustedAgents?.length) {
                await this.messenger.sendParcelInfo(
                    MessageFactory.createParcelInfoMessage(
                        this.playerInfo.id.toString(),
                        this._beliefs.trustedAgentsIds,
                        this._beliefs.freeParcels,
                    ),
                );

                // Share agent information with other agents
                await this.messenger.sendAgentsInfo(
                    MessageFactory.createAgentsUpdateMessage(
                        this.playerInfo.id.toString(),
                        this._beliefs.trustedAgentsIds,
                        this._beliefs.opponentAgents,
                    ),
                );
            }
        }, 4000);
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
            if (this._beliefs.isTrustedAgent(agent.agentId)) {
                return;
            }

            this._beliefs.addTrustedAgent(agent);
            this._beliefs.queueAgentsSynchronization([agent]);
            await this.assignExplorationSectors();

            // Reply with our own hello message
            const helloMessage: HelloMessage = MessageFactory.createHelloMessage(
                this.playerInfo.id.toString(),
                this._beliefs.myPosition,
                this._beliefs.myScore,
                agent.instantiationTime,
                agent.agentId,
            );

            await this.messenger.replyHelloMessage(helloMessage);
        });

        this.messenger.onExplorationAssignmentReceived((assignment: Position[]) => {
            this._beliefs.explorationSector = assignment;
        });

        // Additional handlers for handoff messages would be added here
    }

    /**
     * Sends a hello message to all agents
     * @private
     */
    private async shoutHelloMessage(): Promise<void> {
        const helloMessage: HelloMessage = MessageFactory.createHelloMessage(
            this.playerInfo.id.toString(),
            this._beliefs.myPosition,
            this._beliefs.myScore,
            this._beliefs.myInstantiationTime,
        );

        await this.messenger.shoutHelloMessage(helloMessage);
    }

    /**
     * This method implements the agent loop
     */
    private async _run(): Promise<void> {
        while (this._isAlive) {
            // Synchronize beliefs
            this._beliefs.synchronizeKnownAgents();
            this._beliefs.synchronizeKnownParcels();

            this._desiresManager.generateExplorationDesires();
            // Generate desires based on current beliefs
            //await this._desiresManager.generateDesires();

            // Check if we need to execute a handoff
            if (this._handoffCoordinator.hasActiveHandoff()) {
                const handoffExecuted = await this.executeHandoff();
                if (handoffExecuted) {
                    // Reset current intention after handoff
                    this._intentionManager.resetCurrentIntention();
                    continue;
                }
            }

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
            // We're receiving parcel
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

    private async assignExplorationSectors(): Promise<void> {
        if (!this._canRecalculateMapSectors || !this._beliefs.isTheMaster) return;

        const trustedAgents: Agent[] = this._beliefs.trustedAgents;
        if (!trustedAgents?.length) {
            return;
        }

        const mapClusters: ClusteredTiles[] = await this._beliefs.calculateMapClusters();

        for (const agent of trustedAgents) {
            const agentPosition: Position = agent.position;
            const closestMedoid = mapClusters
                .map((cluster: ClusteredTiles, index: number) => {
                    return {
                        cluster,
                        clusterIndex: index,
                        distance: cluster.medoid.manhattanDistance(agentPosition),
                    };
                })
                .sort((d1, d2) => d1.distance - d2.distance)
                .shift();

            mapClusters.splice(closestMedoid.clusterIndex, 1);

            await this.messenger.sendExplorationAssignment(
                MessageFactory.createExplorationAssignmentMessage(
                    this._beliefs.myId,
                    agent.agentId,
                    closestMedoid.cluster.positions,
                ),
            );
        }

        //Assigning the remaining cluster to the current master agent
        const remainingCluster: ClusteredTiles = mapClusters.shift();
        this._beliefs.explorationSector = remainingCluster.positions;
    }
}

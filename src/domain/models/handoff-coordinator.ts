import type { BeliefContainer } from "@domain/beliefs";
import type { Messenger } from "@domain/communication/messenger";
import type { DesiresManager } from "@domain/desires";
import type { Position } from "@domain/models/environment";
import { v4 as uuidv4 } from "uuid";

/**
 * Status of a handoff request
 */
export enum HandoffStatus {
    ACCEPTED = "accepted",
    REJECTED = "rejected",
}

export enum HandoffUpdateType {
    NEW_METTING_POINT = "new_meeting_point",
    PARCELS_POSITION = "parcels_position",
    CANCELED = "canceled",
    NEW_METTING_POINT_ACCEPTED = "new_meeting_point_accepted",
    COMPLETED = "completed",
}

export enum HandoffActionRequire {
    MOVE = "move",
    MOVE_AWAY = "move away",
    PICK_UP = "pick_up",
}

export interface HandoffResponse {
    requestId: string;
    initiatorId: string;
    recipientIds: string[];
    status: HandoffStatus;
    meetingPosition?: Position;
    estimatedArrivalTime?: number;
}

export interface BaseHandoff {
    initiatorId: string;
    receiverId: string;
    meetingPosition?: Position;
    timeToMeet?: number;
    estimatedArrivalTime?: number;
    parcelIds?: string[];
    actionRequired?: HandoffActionRequire;
}

export interface HandoffUpdate extends BaseHandoff {
    updateId: string;
    handoffId: string;
    updateType: HandoffUpdateType;
}

/**
 * Represents a handoff request between agents
 */
export interface HandoffRequest extends BaseHandoff {
    requestId: string;
    urgency: number;
}

/**
 * Manages handoff coordination between agents
 */
export class HandoffCoordinator {
    // Outgoing handoff requests initiated by this agent
    private outgoingRequests: Map<string, HandoffRequest> = new Map();

    // Incoming handoff requests from other agents
    private incomingRequests: Map<string, HandoffRequest> = new Map();

    // Currently active handoff (if any)
    private activeHandoff: HandoffRequest | null = null;

    // Outgoing handoff Update initiated by this agent
    private outgoingUpdate: Map<string, HandoffUpdate> = new Map();

    // Incoming handoff Update from other agents
    private incomingUpdate: Map<string, HandoffUpdate> = new Map();

    constructor(
        private readonly messenger: Messenger,
        private readonly beliefs: BeliefContainer,
        private readonly desireManager: DesiresManager,
    ) {
        // Handle incoming handoff requests
        this.messenger.onHandoffRequestReceived(async (request: HandoffRequest) => {
            // Store the incoming request
            this.incomingRequests.set(request.requestId, request);
            // Process the incoming request (will be handled by the intention manager)
            await this.handleHandoffRequest(request);
        });

        // Handle incoming handoff response
        this.messenger.onHandoffResponseReceived(async (response: HandoffResponse) => {
            await this.handleHandoffResponse(response).catch((error) => {
                console.log(`handleHandoffRequest: ${error}`); // TODO: Remove
            });
        });

        // Handle incoming handoff update
        this.messenger.onHandoffUpdateReceived(async (update: HandoffUpdate) => {
            this.incomingUpdate.set(update.updateId, update);
            await this.handleHandoffUpdate(update).catch((error) => {
                console.log(`onHandoffUpdateReceived: ${error}`); // TODO: Remove
            });
        });
    }

    /**
     * Evaluates whether a handoff is feasible from the receiving agent's perspective
     * @param request The handoff request to evaluate
     * @returns True if the handoff appears feasible, false otherwise
     */
    private evaluateHandoffFeasibility(request: BaseHandoff): boolean {
        // Check if we can reach the meeting position
        if (this.beliefs.myPosition && request.meetingPosition) {
            // Calculate the path to meeting position if possible
            const canReachMeeting: Position[] = this.beliefs.calculateMovingPath(
                request.meetingPosition,
                this.beliefs.getOccupiedPositions(),
            );

            if (!canReachMeeting) {
                return false;
            }
        }

        return true;
    }

    /**
     * Creates a new handoff request
     * @param initiatorId ID of the agent initiating the handoff
     * @param receiverId ID of the agent receiving the handoff
     * @param parcelIds IDs of parcels to hand off
     * @param meetingPosition Position where the handoff should occur
     * @param urgency Urgency of the handoff (1-10)
     * @returns The created handoff request
     */
    async createHandoffRequest(
        initiatorId: string,
        receiverId: string,
        parcelIds: string[],
        meetingPosition: Position,
        urgency: number,
    ): Promise<HandoffRequest> {
        const requestId: string = uuidv4();
        const request: HandoffRequest = {
            requestId,
            initiatorId,
            receiverId,
            parcelIds,
            meetingPosition,
            urgency,
        };

        this.outgoingRequests.set(requestId, request);
        await this.messenger.sendHandoffRequest(request);

        return request;
    }

    /**
     * Accepts an incoming handoff request
     * @param requestId ID of the request to accept
     * @param estimatedArrivalTime When the agent expects to arrive at the meeting position
     * @returns The updated handoff request, or null if not found
     */
    acceptIncomingRequest(requestId: string, estimatedArrivalTime: number): HandoffRequest | null {
        const request = this.incomingRequests.get(requestId);
        if (!request) return null;

        request.estimatedArrivalTime = estimatedArrivalTime;
        this.activeHandoff = request;

        return request;
    }

    /**
     * Rejects an incoming handoff request
     * @param requestId ID of the request to reject
     * @returns The updated handoff request, or null if not found
     */
    rejectIncomingRequest(requestId: string): HandoffRequest | null {
        const request = this.incomingRequests.get(requestId);
        if (!request) return null;

        //request.status = HandoffStatus.REJECTED;
        this.incomingRequests.delete(requestId);

        return request;
    }

    /**
     * Handles a handoff request from another agent
     * @param request The handoff request to handle
     */
    async handleHandoffRequest(request: HandoffRequest): Promise<void> {
        const shouldAccept: boolean = this.evaluateHandoffFeasibility(request);
        await this.messenger.sendHandoffResponseMessage({
            requestId: request.requestId,
            initiatorId: this.beliefs.myId,
            recipientIds: [request.initiatorId],
            status: shouldAccept ? HandoffStatus.ACCEPTED : HandoffStatus.REJECTED,
        } as HandoffResponse);

        if (shouldAccept) {
            //We are accepting the hand off we need to generate its desire
            this.desireManager.generatePickupHandoffDesire(
                request.parcelIds,
                request.meetingPosition,
                request.urgency,
            );
        }
    }

    /**
     * Handles a handoff response from another agent
     * @param response The handoff response to handle
     */
    async handleHandoffResponse(response: HandoffResponse): Promise<void> {
        switch (response.status) {
            case HandoffStatus.ACCEPTED:
                if (this.outgoingRequests.has(response.requestId)) {
                    //this.outgoingRequests.get(response.requestId).status = HandoffStatus.IN_PROGRESS;
                    this.activeHandoff = this.outgoingRequests.get(response.requestId);
                }

                break;

            case HandoffStatus.REJECTED:
                //this.completeHandoff(response.requestId, false);

                break;

            default:
                console.log(`handleHandoffResponse not valid response status: ${response.status}`);
        }

        this.incomingRequests.delete(response.requestId);
    }

    async createHandofUpdate(
        initiatorId: string,
        handoffId: string,
        receiverId: string,
        updateType: HandoffUpdateType,
        actionRequired: HandoffActionRequire = null,
        parcelIds: string[] = null,
        meetingPosition: Position = null,
        timeToMeet: number = null,
    ): Promise<HandoffUpdate> {
        const updateId = uuidv4();

        let update: HandoffUpdate = null;

        switch (updateType) {
            case HandoffUpdateType.NEW_METTING_POINT: {
                update = {
                    updateId: updateId,
                    handoffId: handoffId,
                    initiatorId: initiatorId,
                    receiverId: receiverId,
                    actionRequired: actionRequired,
                    meetingPosition: meetingPosition,
                    timeToMeet: timeToMeet,
                    updateType: updateType,
                } as HandoffUpdate;

                break;
            }
            case HandoffUpdateType.PARCELS_POSITION: {
                update = {
                    updateId: updateId,
                    handoffId: handoffId,
                    initiatorId: initiatorId,
                    receiverId: receiverId,
                    actionRequired: HandoffActionRequire.PICK_UP,
                    meetingPosition: meetingPosition,
                    parcelIds: parcelIds,
                    updateType: updateType,
                } as HandoffUpdate;

                break;
            }
            case HandoffUpdateType.CANCELED: {
                update = {
                    updateId: updateId,
                    handoffId: handoffId,
                    initiatorId: initiatorId,
                    receiverId: receiverId,
                    updateType: updateType,
                } as HandoffUpdate;

                break;
            }
            case HandoffUpdateType.COMPLETED: {
                update = {
                    updateId: updateId,
                    handoffId: handoffId,
                    initiatorId: initiatorId,
                    receiverId: receiverId,
                    updateType: updateType,
                } as HandoffUpdate;

                break;
            }
        }

        await this.messenger.sendHandoffUpdateMessage(update);
        this.outgoingUpdate.set(updateId, update);

        console.log(`createHandofUpdate updateType: ${updateType}`);

        return update;
    }

    async handleHandoffUpdate(update: HandoffUpdate) {
        if (this.activeHandoff != null && this.activeHandoff.requestId == update.handoffId) {
            console.log(`handleHandoffUpdate updateType: ${update.updateType}`);

            switch (update.updateType) {
                case HandoffUpdateType.NEW_METTING_POINT: {
                    console.log(`handleHandoffUpdate meetingPosition: ${update.meetingPosition}`);

                    const feasibility = this.evaluateHandoffFeasibility(update);

                    console.log(`handleHandoffUpdate feasibility: ${feasibility}`);

                    if (feasibility) {
                        this.activeHandoff.meetingPosition = update.meetingPosition;
                        this.activeHandoff.timeToMeet = update.timeToMeet;
                        this.activeHandoff.actionRequired = update.actionRequired;

                        await this.messenger.sendHandoffUpdateMessage({
                            updateId: update.updateId,
                            handoffId: update.handoffId,
                            initiatorId: this.beliefs.myId,
                            receiverId: update.initiatorId,
                            updateType: HandoffUpdateType.NEW_METTING_POINT_ACCEPTED,
                            actionRequired: HandoffActionRequire.MOVE,
                        } as HandoffUpdate);
                    } else {
                        await this.messenger.sendHandoffUpdateMessage({
                            updateId: update.updateId,
                            handoffId: update.handoffId,
                            initiatorId: this.beliefs.myId,
                            receiverId: update.initiatorId,
                            updateType: HandoffUpdateType.CANCELED,
                        } as HandoffUpdate);

                        //this.completeHandoff(update.handoffId, false);
                    }

                    break;
                }

                case HandoffUpdateType.COMPLETED: {
                    //this.activeHandoff.status = HandoffStatus.COMPLETED;
                    //this.completeHandoff(update.handoffId, true);

                    console.log(`handleHandoffUpdate COMPLETED:`);
                    this.beliefs.freeParcels.forEach((parcel) => {
                        console.log(parcel.id);
                    });

                    break;
                }

                case HandoffUpdateType.PARCELS_POSITION: {
                    this.activeHandoff.meetingPosition = update.meetingPosition;
                    this.activeHandoff.actionRequired = update.actionRequired;

                    break;
                }

                case HandoffUpdateType.NEW_METTING_POINT_ACCEPTED: {
                    const outgoing = this.outgoingUpdate.get(update.updateId);
                    this.activeHandoff.meetingPosition = outgoing.meetingPosition;
                    this.activeHandoff.timeToMeet = outgoing.timeToMeet;

                    break;
                }
            }
        }

        this.incomingUpdate.delete(update.updateId);
    }

    /**
     * Sends a handoff confirmation message to the partner agent
     * @param handoff The handoff request that was completed
     * @param success Whether the handoff was successful
     */
    public async sendHandoffConfirmation(handoff: HandoffRequest): Promise<void> {
        try {
            // Determine the recipient (the other agent in the handoff)
            const recipientId =
                this.beliefs.myId === handoff.initiatorId
                    ? handoff.receiverId
                    : handoff.initiatorId;

            await this.createHandofUpdate(
                this.beliefs.myId,
                handoff.requestId,
                recipientId,
                HandoffUpdateType.COMPLETED,
            );

            console.log(`Sent handoff confirmation for request ${handoff.requestId}`);
        } catch (error) {
            console.error("Error sending handoff confirmation:", error);
        }
    }
}

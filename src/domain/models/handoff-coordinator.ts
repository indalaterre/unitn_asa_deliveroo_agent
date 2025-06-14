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
}

export interface HandoffUpdate extends BaseHandoff {
    updateId: string;
    handoffId: string;
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
}

import { ObservedAgent } from "./agent";
import type { CollaborativeIntentionTypes, Territory } from "./collaborative-intentions";
import type { Position } from "./environment";
import type { IntentionTypes } from "./intention";

/**
 * Status of a handoff operation
 */
export enum HandoffStatus {
    REQUESTED = "requested", // Initial request sent/received
    ACCEPTED = "accepted", // Handoff has been accepted
    REJECTED = "rejected", // Handoff has been rejected
    IN_PROGRESS = "in_progress", // Agents are moving to meeting point
    WAITING = "waiting", // At least one agent is waiting at meeting point
    COMPLETED = "completed", // Handoff has been completed successfully
    FAILED = "failed", // Handoff failed
    EXPIRED = "expired", // Handoff request expired without completion
}

/**
 * Represents a handoff operation between agents
 */
export interface HandoffOperation {
    requestId: string; // Unique ID for this handoff
    sourceAgentId: string; // Agent giving parcels
    targetAgentId: string; // Agent receiving parcels
    parcelIds: string[]; // Parcels being handed off
    meetingPosition: Position; // Where the handoff will occur
    status: HandoffStatus; // Current status of the handoff
    timeToMeet: number; // When to meet (timestamp)
    estimatedArrivalTime?: number; // When the target agent estimates arrival
    expiresAt: number; // When this handoff expires
    initiatedAt: number; // When this handoff was initiated
    completedAt?: number; // When this handoff was completed/failed
    priority: number; // Priority of this handoff (1-10)
}

/**
 * Represents information about another agent's intention
 */
export interface AgentIntentionInfo {
    agentId: string;
    intentionType: IntentionTypes | CollaborativeIntentionTypes;
    targetPosition: Position;
    currentPosition: Position;
    timestamp: number;
    priority?: number;
    isCarrying: boolean;
}

/**
 * Represents a help request from another agent
 */
export interface HelpRequest {
    requestId: string;
    agentId: string;
    requestType: "pickup" | "delivery";
    position: Position;
    parcelIds?: string[];
    urgency: number;
    timestamp: number;
    expiresAt: number;
    responded: boolean;
}

/**
 * Represents a help response from another agent
 */
export interface HelpResponse {
    requestId: string;
    agentId: string;
    accepted: boolean;
    estimatedTimeToArrive?: number;
    timestamp: number;
}

/**
 * Represents a coordination agreement between agents
 */
export interface CoordinationAgreement {
    agentId: string;
    action: string;
    position: Position;
    timestamp: number;
    expiresAt: number;
    details: any;
    active: boolean;
}

/**
 * Container for collaborative beliefs
 */
export class CollaborativeBeliefs {
    // Known intentions of other agents
    private _agentIntentions: Map<string, AgentIntentionInfo> = new Map();

    // Territories claimed by agents
    private _territories: Territory[] = [];

    // Active help requests
    private _helpRequests: Map<string, HelpRequest> = new Map();

    // Responses to our help requests
    private _helpResponses: Map<string, HelpResponse[]> = new Map();

    // Active coordination agreements
    private _coordinationAgreements: Map<string, CoordinationAgreement> = new Map();

    // Handoff operations (ongoing and completed)
    private _handoffOperations: Map<string, HandoffOperation> = new Map();

    // Track handoffs by agent ID for quick lookups
    private _handoffsByAgent: Map<string, string[]> = new Map();

    // Trust levels for other agents (0-100)
    private _trustLevels: Map<string, number> = new Map();

    // Our own agent ID
    private readonly _ownId: string;

    constructor(ownId: string) {
        this._ownId = ownId;
    }

    /**
     * Update an agent's intention information
     */
    updateAgentIntention(intentionInfo: AgentIntentionInfo): void {
        // Don't track our own intentions here
        if (intentionInfo.agentId === this._ownId) {
            return;
        }

        this._agentIntentions.set(intentionInfo.agentId, intentionInfo);
    }

    /**
     * Get all known agent intentions
     */
    getAgentIntentions(): AgentIntentionInfo[] {
        return Array.from(this._agentIntentions.values());
    }

    /**
     * Get intention for a specific agent
     */
    getAgentIntention(agentId: string): AgentIntentionInfo | undefined {
        return this._agentIntentions.get(agentId);
    }

    /**
     * Add a territory claim
     */
    addTerritory(territory: Territory): void {
        // Remove any existing territories claimed by this agent
        this._territories = this._territories.filter((t) => t.claimedBy !== territory.claimedBy);
        this._territories.push(territory);
    }

    /**
     * Get all active territories
     */
    getTerritories(): Territory[] {
        const now = Date.now();
        // Clean up expired territories
        this._territories = this._territories.filter((t) => t.expiresAt > now);
        return this._territories;
    }

    /**
     * Check if a position is within any claimed territory
     */
    isPositionInClaimedTerritory(position: Position): boolean {
        const territories = this.getTerritories();
        return territories.some((territory) => {
            const distance =
                Math.abs(position.row - territory.center.row) +
                Math.abs(position.column - territory.center.column);
            return distance <= territory.radius && territory.claimedBy !== this._ownId;
        });
    }

    /**
     * Add a help request
     */
    addHelpRequest(request: HelpRequest): void {
        this._helpRequests.set(request.requestId, request);
    }

    /**
     * Get all active help requests
     */
    getActiveHelpRequests(): HelpRequest[] {
        const now = Date.now();
        const requests: HelpRequest[] = [];

        for (const request of this._helpRequests.values()) {
            if (request.expiresAt > now && !request.responded) {
                requests.push(request);
            }
        }

        return requests;
    }

    /**
     * Mark a help request as responded to
     */
    markHelpRequestResponded(requestId: string): void {
        const request = this._helpRequests.get(requestId);
        if (request) {
            request.responded = true;
        }
    }

    /**
     * Add a help response
     */
    addHelpResponse(response: HelpResponse): void {
        const responses = this._helpResponses.get(response.requestId) || [];
        responses.push(response);
        this._helpResponses.set(response.requestId, responses);
    }

    /**
     * Get all responses for a specific help request
     */
    getHelpResponses(requestId: string): HelpResponse[] {
        return this._helpResponses.get(requestId) || [];
    }

    /**
     * Add a coordination agreement
     */
    addCoordinationAgreement(agreement: CoordinationAgreement): void {
        this._coordinationAgreements.set(`${agreement.agentId}-${agreement.action}`, agreement);
    }

    /**
     * Get all active coordination agreements
     */
    getActiveCoordinationAgreements(): CoordinationAgreement[] {
        const now = Date.now();
        const agreements: CoordinationAgreement[] = [];

        for (const agreement of this._coordinationAgreements.values()) {
            if (agreement.expiresAt > now && agreement.active) {
                agreements.push(agreement);
            }
        }

        return agreements;
    }

    /**
     * Update trust level for an agent based on their behavior
     * @param agentId The agent ID
     * @param trustChange Amount to change trust by (-100 to 100)
     */
    updateTrustLevel(agentId: string, trustChange: number): void {
        const currentTrust = this._trustLevels.get(agentId) || 50; // Default to neutral trust
        const newTrust = Math.max(0, Math.min(100, currentTrust + trustChange));
        this._trustLevels.set(agentId, newTrust);
    }

    /**
     * Get trust level for an agent
     * @param agentId The agent ID
     * @returns Trust level (0-100)
     */
    getTrustLevel(agentId: string): number {
        return this._trustLevels.get(agentId) || 50; // Default to neutral trust
    }

    /**
     * Creates a new handoff operation
     * @param requestId ID of the handoff request
     * @param sourceAgentId ID of the agent giving parcels
     * @param targetAgentId ID of the agent receiving parcels
     * @param parcelIds IDs of parcels being handed off
     * @param meetingPosition Position where the handoff will occur
     * @param timeToMeet When to meet (timestamp)
     * @param expiresAt When the handoff request expires
     * @param priority Priority of this handoff (1-10)
     * @returns The created handoff operation
     */
    createHandoffOperation(
        requestId: string,
        sourceAgentId: string,
        targetAgentId: string,
        parcelIds: string[],
        meetingPosition: Position,
        timeToMeet: number,
        expiresAt: number,
        priority = 5,
    ): HandoffOperation {
        const handoff: HandoffOperation = {
            requestId,
            sourceAgentId,
            targetAgentId,
            parcelIds,
            meetingPosition,
            status: HandoffStatus.REQUESTED,
            timeToMeet,
            expiresAt,
            initiatedAt: Date.now(),
            priority,
        };

        this._handoffOperations.set(requestId, handoff);

        // Update handoffs by agent for both participants
        this.addHandoffToAgent(sourceAgentId, requestId);
        this.addHandoffToAgent(targetAgentId, requestId);

        return handoff;
    }

    /**
     * Associates a handoff with an agent for quick lookup
     * @param agentId ID of the agent
     * @param handoffId ID of the handoff
     */
    private addHandoffToAgent(agentId: string, handoffId: string): void {
        const handoffs = this._handoffsByAgent.get(agentId) || [];
        if (!handoffs.includes(handoffId)) {
            handoffs.push(handoffId);
            this._handoffsByAgent.set(agentId, handoffs);
        }
    }

    /**
     * Gets a handoff operation by its ID
     * @param handoffId ID of the handoff
     * @returns The handoff operation, or undefined if not found
     */
    getHandoffOperation(handoffId: string): HandoffOperation | undefined {
        return this._handoffOperations.get(handoffId);
    }

    /**
     * Gets all handoff operations involving a specific agent
     * @param agentId ID of the agent
     * @returns Array of handoff operations
     */
    getHandoffsByAgent(agentId: string): HandoffOperation[] {
        const handoffIds = this._handoffsByAgent.get(agentId) || [];
        return handoffIds
            .map((id) => this._handoffOperations.get(id))
            .filter((handoff) => handoff !== undefined) as HandoffOperation[];
    }

    /**
     * Gets all handoff operations where this agent is the source (giving parcels)
     * @returns Array of handoff operations
     */
    getHandoffsAsSource(): HandoffOperation[] {
        return this.getHandoffsByAgent(this._ownId).filter(
            (handoff) => handoff.sourceAgentId === this._ownId,
        );
    }

    /**
     * Gets all handoff operations where this agent is the target (receiving parcels)
     * @returns Array of handoff operations
     */
    getHandoffsAsTarget(): HandoffOperation[] {
        return this.getHandoffsByAgent(this._ownId).filter(
            (handoff) => handoff.targetAgentId === this._ownId,
        );
    }

    /**
     * Gets all active handoff operations
     * @returns Array of active handoff operations
     */
    getActiveHandoffs(): HandoffOperation[] {
        const now = Date.now();
        const activeStatuses = [
            HandoffStatus.REQUESTED,
            HandoffStatus.ACCEPTED,
            HandoffStatus.IN_PROGRESS,
            HandoffStatus.WAITING,
        ];

        return Array.from(this._handoffOperations.values()).filter(
            (handoff) => activeStatuses.includes(handoff.status) && handoff.expiresAt > now,
        );
    }

    /**
     * Updates the status of a handoff operation
     * @param handoffId ID of the handoff
     * @param status New status
     * @param additionalData Additional data to update
     * @returns Updated handoff operation, or undefined if not found
     */
    updateHandoffStatus(
        handoffId: string,
        status: HandoffStatus,
        additionalData: Partial<HandoffOperation> = {},
    ): HandoffOperation | undefined {
        const handoff = this._handoffOperations.get(handoffId);
        if (!handoff) return undefined;

        // Update status
        handoff.status = status;

        // If completing or failing, record completion time
        if (status === HandoffStatus.COMPLETED || status === HandoffStatus.FAILED) {
            handoff.completedAt = Date.now();

            // Update trust levels based on outcome
            const otherAgentId =
                handoff.sourceAgentId === this._ownId
                    ? handoff.targetAgentId
                    : handoff.sourceAgentId;

            const trustChange = status === HandoffStatus.COMPLETED ? 5 : -10;
            this.updateTrustLevel(otherAgentId, trustChange);
        }

        // Update any additional fields
        Object.assign(handoff, additionalData);

        // Update the handoff in storage
        this._handoffOperations.set(handoffId, handoff);

        return handoff;
    }

    /**
     * Determines if a handoff should be initiated with another agent
     * @param agentId ID of the potential partner agent
     * @param currentPosition Our current position
     * @param targetPosition Our target position
     * @param otherAgentPosition Position of the other agent
     * @param parcelScore Score of parcels to hand off
     * @returns True if a handoff would be beneficial
     */
    shouldInitiateHandoff(
        agentId: string,
        currentPosition: Position,
        targetPosition: Position,
        otherAgentPosition: Position,
        parcelScore: number,
    ): boolean {
        // Don't initiate handoffs with untrusted agents
        if (this.getTrustLevel(agentId) < 30) return false;

        // Calculate our distance to the target
        const ourDistanceToTarget =
            Math.abs(currentPosition.row - targetPosition.row) +
            Math.abs(currentPosition.column - targetPosition.column);

        // Calculate other agent's distance to the target
        const theirDistanceToTarget =
            Math.abs(otherAgentPosition.row - targetPosition.row) +
            Math.abs(otherAgentPosition.column - targetPosition.column);

        // Calculate potential meeting point
        const meetingPoint = {
            row: Math.floor((currentPosition.row + otherAgentPosition.row) / 2),
            column: Math.floor((currentPosition.column + otherAgentPosition.column) / 2),
        };

        // Calculate distances to meeting point
        const ourDistanceToMeeting =
            Math.abs(currentPosition.row - meetingPoint.row) +
            Math.abs(currentPosition.column - meetingPoint.column);

        const theirDistanceToMeeting =
            Math.abs(otherAgentPosition.row - meetingPoint.row) +
            Math.abs(otherAgentPosition.column - meetingPoint.column);

        // Calculate total distance if we deliver ourselves
        const ourTotalDistance = ourDistanceToTarget;

        // Calculate total distance if we hand off
        const handoffTotalDistance =
            ourDistanceToMeeting + theirDistanceToMeeting + theirDistanceToTarget;

        // Only initiate handoff if it would save at least 30% of the distance
        const distanceSavingRatio = (ourTotalDistance - handoffTotalDistance) / ourTotalDistance;

        // Consider parcel score in the decision
        const scoreBonus = parcelScore > 50 ? 0.1 : 0; // Add bonus for high-value parcels

        return distanceSavingRatio + scoreBonus > 0.3; // 30% improvement threshold
    }

    /**
     * Clean up expired data
     */
    cleanup(): void {
        const now = Date.now();

        // Clean up expired territories
        this._territories = this._territories.filter((t) => t.expiresAt > now);

        // Clean up expired help requests
        for (const [id, request] of this._helpRequests.entries()) {
            if (request.expiresAt < now) {
                this._helpRequests.delete(id);
            }
        }

        // Clean up expired coordination agreements
        for (const [id, agreement] of this._coordinationAgreements.entries()) {
            if (agreement.expiresAt < now) {
                this._coordinationAgreements.delete(id);
            }
        }

        // Clean up old agent intentions (older than 30 seconds)
        const intentionExpiryTime = now - 30000;
        for (const [id, intention] of this._agentIntentions.entries()) {
            if (intention.timestamp < intentionExpiryTime) {
                this._agentIntentions.delete(id);
            }
        }

        // Clean up expired handoffs
        for (const [id, handoff] of this._handoffOperations.entries()) {
            // Mark expired handoffs
            if (
                handoff.expiresAt < now &&
                [
                    HandoffStatus.REQUESTED,
                    HandoffStatus.ACCEPTED,
                    HandoffStatus.IN_PROGRESS,
                    HandoffStatus.WAITING,
                ].includes(handoff.status)
            ) {
                handoff.status = HandoffStatus.EXPIRED;
                handoff.completedAt = now;
                this._handoffOperations.set(id, handoff);
            }

            // Remove very old completed/failed/expired handoffs (older than 5 minutes)
            if (handoff.completedAt && now - handoff.completedAt > 300000) {
                this._handoffOperations.delete(id);

                // Also remove from agent mappings
                this.removeHandoffFromAgent(handoff.sourceAgentId, id);
                this.removeHandoffFromAgent(handoff.targetAgentId, id);
            }
        }
    }

    /**
     * Removes a handoff association from an agent
     * @param agentId ID of the agent
     * @param handoffId ID of the handoff
     */
    private removeHandoffFromAgent(agentId: string, handoffId: string): void {
        const handoffs = this._handoffsByAgent.get(agentId) || [];
        const index = handoffs.indexOf(handoffId);
        if (index !== -1) {
            handoffs.splice(index, 1);
            if (handoffs.length > 0) {
                this._handoffsByAgent.set(agentId, handoffs);
            } else {
                this._handoffsByAgent.delete(agentId);
            }
        }
    }
}

import type { Agent, Parcel } from "@domain/models";
import type { Position } from "@domain/models/environment";
import type { HandoffActionRequire, HandoffStatus, HandoffUpdateType } from "@domain/models/handoff-coordinator";
import {
    type AgentPositionUpdate,
    type ExplorationSectorAssignment,
    type HandoffResponseMessage,
    type HandoffRequestMessage,
    type HandoffUpdateMessage,
    type HelloMessage,
    type Message,
    MessageType,
    type ParcelInfoMessage,
} from "./messenger";

/**
 * Factory class for creating different types of messages
 */
export class MessageFactory {
    /**
     * Create a base message with common fields
     * @param type Message type
     * @param senderId ID of the sending agent
     * @param recipientIds Optional ID of the recipient agent
     * @returns Base message object
     */
    private static createBaseMessage(
        type: MessageType,
        senderId: string,
        recipientIds?: string[],
    ): Message {
        return {
            type,
            senderId,
            recipientIds,
            timestamp: Date.now(),
        };
    }

    /**
     * Create a Hello message
     * @param senderId ID of the sending agent
     * @param position Current position of the agent
     * @param score Current score of the agent
     * @param recipientId Optional ID of the recipient agent
     * @param instantiationTime the time the agent has been instantiated
     * @returns HelloMessage object
     */
    public static createHelloMessage(
        senderId: string,
        position: Position,
        score: number,
        instantiationTime: number,
        recipientId?: string,
    ): HelloMessage {
        return {
            ...this.createBaseMessage(MessageType.HELLO, senderId, [recipientId]),
            type: MessageType.HELLO,
            senderId,
            position,
            score,
            instantiationTime,
        };
    }

    /**
     * Create a Parcel Info message
     * @param senderId ID of the sending agent
     * @param recipientIds Array of recipient agent ids
     * @param agents Array of agent information to share
     * @returns ParcelInfoMessage object
     */
    public static createAgentsUpdateMessage(
        senderId: string,
        recipientIds: string[],
        agents: Agent[],
    ): AgentPositionUpdate {
        const messageAgents = agents.map((agent: Agent) => {
            return {
                agentId: agent.agentId,
                position: agent.position,
                score: agent.score,
            };
        });
        return {
            ...this.createBaseMessage(MessageType.AGENT_UPDATE, senderId, recipientIds),
            agents: messageAgents,
            type: MessageType.AGENT_UPDATE,
        };
    }

    /**
     * Create a Parcel Info message
     * @param senderId ID of the sending agent
     * @param recipientIds Array of recipient agent ids
     * @param parcels Array of parcel information to share
     * @returns ParcelInfoMessage object
     */
    public static createParcelInfoMessage(
        senderId: string,
        recipientIds: string[],
        parcels: Parcel[],
    ): ParcelInfoMessage {
        const messageParcels = parcels.map((parcel: Parcel) => {
            return {
                id: parcel.id,
                position: parcel.position,
                score: parcel.score.currentValue,
                agentId: parcel.agentId?.toString(),
            };
        });

        return {
            ...this.createBaseMessage(MessageType.PARCEL_INFO, senderId, recipientIds),
            type: MessageType.PARCEL_INFO,
            parcels: messageParcels,
        };
    }

    /**
     * Create an ExplorationAssignment message
     * @param senderId the master agent id
     * @param recipientId the agent recipient for the assignment
     * @param positionsToExplore the list of positions assigned
     * @returns ParcelInfoMessage object
     */
    public static createExplorationAssignmentMessage(
        senderId: string,
        recipientId: string,
        positionsToExplore: Position[],
    ): ExplorationSectorAssignment {
        return {
            ...this.createBaseMessage(MessageType.EXPLORATION_SECTOR_ASSIGNMENT, senderId, [
                recipientId,
            ]),
            type: MessageType.EXPLORATION_SECTOR_ASSIGNMENT,
            positions: positionsToExplore,
        };
    }

    /**
     * Create a Handoff Request message
     * @param initiatorId ID of the sending agent
     * @param parcelIds IDs of parcels to hand off
     * @param meetingPosition Proposed meeting location
     * @param urgency Priority of this handoff (1-10)
     * @param timeToMeet When to meet (timestamp)
     * @param expiresAt When this request expires
     * @returns HandoffRequestMessage object with a generated requestId
     */
    public static createHandoffRequestMessage(
        requestId: string,
        initiatorId: string,
        receiverId: string,
        parcelIds: string[],
        meetingPosition: Position,
        urgency: number,
        timeToMeet: number,
        expiresAt: number,
        status: HandoffStatus,
        actionRequired: HandoffActionRequire,
        estimatedArrivalTime?: number,
    ): HandoffRequestMessage {
        return {
            ...this.createBaseMessage(MessageType.HANDOFF_REQUEST, initiatorId, [receiverId]),
            type: MessageType.HANDOFF_REQUEST,
            requestId: requestId,
            parcelIds: parcelIds,
            meetingPosition: meetingPosition,
            urgency: urgency,
            timeToMeet: timeToMeet,
            expiresAt: expiresAt,
            status: status,
            actionRequired: actionRequired,
            estimatedArrivalTime: estimatedArrivalTime,
        };
    }

    /**
     * Create a Handoff Confirm message
     * @param requestId ID of the original request
     * @param initiatorId ID of the agent that initiated the handoff
     * @param recipientId ID of the agent that accepted the handoff
     * @param estimatedArrivalTime When the agent expects to arrive
     * @returns HandoffConfirmMessage object
     */
    public static createHandoffResponseMessage(
        requestId: string,
        initiatorId: string,
        recipientIds: string[],
        status: HandoffStatus,
        meetingPosition: Position,
        estimatedArrivalTime: number
    ): HandoffResponseMessage {
        return {
            ...this.createBaseMessage(MessageType.HANDOFF_RESPONSE, initiatorId, recipientIds),
            type: MessageType.HANDOFF_RESPONSE,
            status: status,
            requestId: requestId,
            meetingPosition: meetingPosition,
            estimatedArrivalTime: estimatedArrivalTime,
        };
    }

    /**
     * Create a Handoff Confirm message
     * @param requestId ID of the original request
     * @param initiatorId ID of the agent that initiated the handoff
     * @param recipientId ID of the agent that accepted the handoff
     * @param estimatedArrivalTime When the agent expects to arrive
     * @returns HandoffConfirmMessage object
     */
    public static createHandoffUpdateMessage(
        updateId: string,
        handoffId: string,
        initiatorId: string,
        receiverId: string,
        update: HandoffUpdateType,
        meetingPosition: Position,
        actionRequired: HandoffActionRequire,
        estimatedArrivalTime: number
    ): HandoffUpdateMessage {
        return {
            ...this.createBaseMessage(MessageType.HANDOFF_UPDATE, initiatorId, [receiverId]),
            type: MessageType.HANDOFF_UPDATE,
            updateId: updateId,
            handoffId: handoffId,
            updateType: update,
            meetingPosition: meetingPosition,
            actionRequired: actionRequired,
            estimatedArrivalTime: estimatedArrivalTime,
        };
    }
}

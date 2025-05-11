import type { Agent, Parcel } from "@domain/models";
import type { Position } from "@domain/models/environment";
import type { HandoffStatus } from "@domain/models/handoff-coordinator";
import {
    type AgentPositionUpdate,
    type HandoffConfirmMessage,
    type HandoffRequestMessage,
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
     * @param recipientId Optional ID of the recipient agent
     * @returns Base message object
     */
    private static createBaseMessage(
        type: MessageType,
        senderId: string,
        recipientId?: string,
    ): Message {
        return {
            type,
            senderId,
            recipientId,
            timestamp: Date.now(),
        };
    }

    /**
     * Create a Hello message
     * @param senderId ID of the sending agent
     * @param position Current position of the agent
     * @param score Current score of the agent
     * @param recipientId Optional ID of the recipient agent
     * @returns HelloMessage object
     */
    public static createHelloMessage(
        senderId: string,
        position: Position,
        score: number,
        recipientId?: string,
    ): HelloMessage {
        return {
            ...this.createBaseMessage(MessageType.HELLO, senderId, recipientId),
            type: MessageType.HELLO,
            senderId,
            position,
            score,
        };
    }

    /**
     * Create a Parcel Info message
     * @param senderId ID of the sending agent
     * @param agents Array of agents information to share
     * @returns ParcelInfoMessage object
     */
    public static createAgentsUpdateMessage(
        senderId: string,
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
            ...this.createBaseMessage(MessageType.AGENT_UPDATE, senderId),
            agents: messageAgents,
            type: MessageType.AGENT_UPDATE,
        };
    }

    /**
     * Create a Parcel Info message
     * @param senderId ID of the sending agent
     * @param parcels Array of parcel information to share
     * @returns ParcelInfoMessage object
     */
    public static createParcelInfoMessage(senderId: string, parcels: Parcel[]): ParcelInfoMessage {
        const messageParcels = parcels.map((parcel: Parcel) => {
            return {
                id: parcel.id,
                position: parcel.position,
                score: parcel.score.currentValue,
                agentId: parcel.agentId?.toString(),
            };
        });

        return {
            ...this.createBaseMessage(MessageType.PARCEL_INFO, senderId),
            type: MessageType.PARCEL_INFO,
            parcels: messageParcels,
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
        estimatedArrivalTime?: number,
    ): HandoffRequestMessage {
        return {
            ...this.createBaseMessage(MessageType.HANDOFF_REQUEST, initiatorId, receiverId),
            type: MessageType.HANDOFF_REQUEST,
            requestId,
            parcelIds,
            meetingPosition,
            urgency,
            timeToMeet,
            expiresAt,
            status,
            estimatedArrivalTime,
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
    public static createHandoffConfirmMessage(
        requestId: string,
        initiatorId: string,
        recipientId: string,
        estimatedArrivalTime: number,
    ): HandoffConfirmMessage {
        return {
            ...this.createBaseMessage(MessageType.HANDOFF_CONFIRM, initiatorId, recipientId),
            type: MessageType.HANDOFF_CONFIRM,
            requestId,
            estimatedArrivalTime,
        };
    }
}

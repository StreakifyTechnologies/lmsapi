import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

interface PrivateMessagePayload {
  senderId: string;
  receiverId: string;
  message: string;
}

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_BASE_URL, // frontend URL
    credentials: true,
  },
})
export class SocketsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;
  private users: Map<string, string[]> = new Map();
  private userRooms: Map<string, string> = new Map();

  handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    console.log(`Client connected with handshake:`, client.handshake.query);

    if (!userId) {
      console.log(`Client ${client.id} connected without a userId`);
      return;
    }

    if (!this.users.has(userId)) {
      this.users.set(userId, []);
    }
    this.users.get(userId)?.push(client.id);

    const roomId = this.getRoomId(userId);
    client.join(roomId);
    this.userRooms.set(userId, roomId);

    console.log(
      `User ${userId} connected with socket ID: ${client.id} and joined room: ${roomId}`,
    );
    console.log('Current users map:', this.users);
  }

  handleDisconnect(client: Socket) {
    let disconnectedUserId: string | undefined = undefined;

    for (const [userId, socketIds] of this.users.entries()) {
      const updatedSocketIds = socketIds.filter((id) => id !== client.id);
      if (updatedSocketIds.length > 0) {
        this.users.set(userId, updatedSocketIds);
      } else {
        this.users.delete(userId);
        disconnectedUserId = userId;
        this.userRooms.delete(userId);
      }
      console.log(`User ${userId} disconnected with socket ID: ${client.id}`);
      break;
    }

    console.log('Current users map:', this.users);
  }

  @SubscribeMessage('private-message')
  handlePrivateMessage(
    @MessageBody() { data }: { data: PrivateMessagePayload },
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`Received data:`, data);

    if (!data.senderId || !data.receiverId || !data.message) {
      console.log(`Invalid private message payload.`);
      return;
    }

    console.log(
      `Private message from ${data.senderId} to ${data.receiverId}: ${data.message}`,
    );

    // *** KEY IMPROVEMENT: Verify sender and use client socket ***
    if (data.senderId !== client.handshake.query.userId) {
      // Security check!
      console.warn(
        `Potential spoofed message. Sender ID in message (${data.senderId}) does not match socket's userId (${client.handshake.query.userId}).`,
      );
      return; // Or handle the spoofing attempt as needed
    }

    const receiverSocketIds = this.users.get(data.receiverId);

    if (receiverSocketIds) {
      if (data.senderId === data.receiverId) {
        // Self-chat
        const roomId = this.getRoomId(data.senderId);
        console.log(`Emitting to self room: ${roomId}, Message:`, data.message);
        this.server.to(roomId).emit('private-message', {
          senderId: data.senderId,
          message: data.message,
        });
      } else {
        // Private message to another user
        console.log(
          `Receiver Socket IDs: ${receiverSocketIds}, Message:`,
          data.message,
        );

        if (receiverSocketIds.length > 0) {
          receiverSocketIds.forEach((socketId) => {
            console.log(
              `Emitting to socket ID: ${socketId}, Message:`,
              data.message,
            );
            this.server.to(socketId).emit('private-message', {
              senderId: data.senderId,
              message: data.message,
            });
          });
        } else {
          console.log(`User ${data.receiverId} is not connected.`);
        }
      }
    } else {
      console.log(`User ${data.receiverId} is not connected.`);
    }
  }

  private getRoomId(userId: string): string {
    return `user_${userId}`;
  }
}

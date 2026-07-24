import type { Observable } from "rxjs";
import type { GanCubeMove } from "gan-web-bluetooth";

export const SMART_CUBE_BRANDS = [
  {
    id: "gan",
    name: "GAN",
    protocol: "GAN BLE",
  },
] as const;

export type SmartCubeBrandId = (typeof SMART_CUBE_BRANDS)[number]["id"];
export type SmartCubeBrand = (typeof SMART_CUBE_BRANDS)[number];

export type SmartCubeCommand =
  | { type: "REQUEST_HARDWARE" }
  | { type: "REQUEST_FACELETS" }
  | { type: "REQUEST_BATTERY" }
  | { type: "REQUEST_RESET" };

export type SmartCubeMove = {
  face: number;
  direction: number;
  move: string;
  localTimestamp: number | null;
  cubeTimestamp: number | null;
};

export type SmartCubeEvent =
  | ({ type: "MOVE"; serial: number } & SmartCubeMove)
  | { type: "FACELETS"; serial: number; facelets: string }
  | {
      type: "GYRO";
      quaternion: { x: number; y: number; z: number; w: number };
      velocity?: { x: number; y: number; z: number };
    }
  | { type: "BATTERY"; batteryLevel: number }
  | {
      type: "HARDWARE";
      hardwareName?: string;
      softwareVersion?: string;
      hardwareVersion?: string;
      productDate?: string;
      gyroSupported?: boolean;
    }
  | { type: "DISCONNECT" };

export type SmartCubeConnection = {
  readonly brand: SmartCubeBrand;
  readonly deviceName: string;
  readonly deviceId: string;
  readonly events$: Observable<SmartCubeEvent>;
  sendCommand(command: SmartCubeCommand): Promise<void>;
  calculateClockSkew(moves: SmartCubeMove[]): number | null;
  disconnect(): Promise<void>;
};

type SmartCubeProtocolAdapter = {
  readonly brand: SmartCubeBrand;
  connect(): Promise<SmartCubeConnection>;
};

const ganAdapter: SmartCubeProtocolAdapter = {
  brand: SMART_CUBE_BRANDS[0],
  async connect() {
    const { connectGanCube, cubeTimestampCalcSkew } = await import("gan-web-bluetooth");
    const connection = await connectGanCube();

    return {
      brand: this.brand,
      deviceName: connection.deviceName,
      deviceId: connection.deviceMAC,
      events$: connection.events$ as Observable<SmartCubeEvent>,
      sendCommand(command) {
        return connection.sendCubeCommand(command);
      },
      calculateClockSkew(moves) {
        if (moves.length <= 10) return null;
        return cubeTimestampCalcSkew(moves as GanCubeMove[]);
      },
      disconnect() {
        return connection.disconnect();
      },
    };
  },
};

const SMART_CUBE_ADAPTERS: Record<SmartCubeBrandId, SmartCubeProtocolAdapter> = {
  gan: ganAdapter,
};

export function isSmartCubeBrandId(value: string): value is SmartCubeBrandId {
  return value in SMART_CUBE_ADAPTERS;
}

export function getSmartCubeBrand(brandId: SmartCubeBrandId): SmartCubeBrand {
  return SMART_CUBE_ADAPTERS[brandId].brand;
}

export function connectSmartCube(brandId: SmartCubeBrandId): Promise<SmartCubeConnection> {
  return SMART_CUBE_ADAPTERS[brandId].connect();
}

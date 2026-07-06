export const CUBE_SERIAL_CYCLE = 256;
export const CUBE_SERIAL_FORWARD_WINDOW = CUBE_SERIAL_CYCLE / 2;

export function normalizeCubeSerial(serial: number) {
  return ((serial % CUBE_SERIAL_CYCLE) + CUBE_SERIAL_CYCLE) % CUBE_SERIAL_CYCLE;
}

export function nextCubeSerial(serial: number) {
  return normalizeCubeSerial(serial + 1);
}

export function cubeSerialForwardDistance(fromSerial: number, toSerial: number) {
  return (normalizeCubeSerial(toSerial) - normalizeCubeSerial(fromSerial) + CUBE_SERIAL_CYCLE) % CUBE_SERIAL_CYCLE;
}

export function isCubeSerialAfter(baseSerial: number, candidateSerial: number) {
  const distance = cubeSerialForwardDistance(baseSerial, candidateSerial);
  return distance > 0 && distance <= CUBE_SERIAL_FORWARD_WINDOW;
}

export function isCubeSerialAtOrBefore(baseSerial: number, candidateSerial: number) {
  return !isCubeSerialAfter(baseSerial, candidateSerial);
}

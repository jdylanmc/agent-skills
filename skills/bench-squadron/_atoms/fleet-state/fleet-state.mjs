import { assertFleetState } from '../../../ship-with-squadron/_atoms/fleet-state/fleet-state.mjs';

export function assertCurrentFleetState(fleetState, manifest) {
  assertFleetState(fleetState, manifest);
  return fleetState;
}

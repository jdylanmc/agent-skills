export function ownedSurfacesFromTopology(topology, ownerTag = 'cmux-orchestrate') {
  return (topology?.surfaces || [])
    .filter((surface) => surface?.owner === ownerTag && surface.id)
    .map((surface) => surface.id);
}

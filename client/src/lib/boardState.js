// A REST save can finish after its caller reconnects and receives the broadcast.
// Treat both deliveries as the same creation, preserving any newer local version.
export function addCreatedCard(cardsByList, card) {
  if (Object.values(cardsByList).some((cards) => cards.some((item) => item._id === card._id))) return cardsByList
  return {
    ...cardsByList,
    [card.list]: [...(cardsByList[card.list] || []), card].sort((a, b) => a.position - b.position),
  }
}

export function addCreatedList(lists, list) {
  if (lists.some((item) => item._id === list._id)) return lists
  return [...lists, list].sort((a, b) => a.position - b.position)
}

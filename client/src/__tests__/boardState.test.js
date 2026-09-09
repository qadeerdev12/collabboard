import { expect, it } from 'vitest'
import { addCreatedCard, addCreatedList } from '../lib/boardState'

it('merges repeated card creation without mutating or duplicating state', () => {
  const initial = { list: [] }
  const card = { _id: 'card', list: 'list', position: 1000 }
  const next = addCreatedCard(initial, card)
  expect(initial.list).toEqual([])
  expect(next.list).toEqual([card])
  expect(addCreatedCard(next, { ...card })).toBe(next)
})

it('does not move a card back or replace newer data when its create response arrives late', () => {
  const current = { original: [], destination: [{ _id: 'card', list: 'destination', title: 'Edited', position: 2000 }] }
  expect(addCreatedCard(current, { _id: 'card', list: 'original', title: 'Old', position: 1000 })).toBe(current)
})

it('keeps new cards and lists sorted by position', () => {
  expect(addCreatedCard({ list: [{ _id: 'later', position: 2000 }] }, { _id: 'first', list: 'list', position: 1000 }).list.map((card) => card._id)).toEqual(['first', 'later'])
  expect(addCreatedList([{ _id: 'later', position: 2000 }], { _id: 'first', position: 1000 }).map((list) => list._id)).toEqual(['first', 'later'])
})

it('does not duplicate or replace a renamed list on repeated create delivery', () => {
  const lists = [{ _id: 'list', title: 'Renamed', position: 2000 }]
  expect(addCreatedList(lists, { _id: 'list', title: 'Old', position: 1000 })).toBe(lists)
})

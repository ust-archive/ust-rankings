/**
 * Maintains groups of values that have been linked together.
 *
 * This is useful for graph-like matching tasks: each value starts in its own
 * group, and `union` merges two groups when an edge says they are equivalent.
 *
 * @example
 * const names = new DisjointSet(['IP, Ivan Chi Ho', 'IP, Chi Ho Ivan', 'CHAN, Tai Man'])
 * names.union('IP, Ivan Chi Ho', 'IP, Chi Ho Ivan')
 * names.members('IP, Ivan Chi Ho')
 * // => Set { 'IP, Ivan Chi Ho', 'IP, Chi Ho Ivan' }
 */
export class DisjointSet<T> {
  #parent = new Map<T, T>()
  #members = new Map<T, Set<T>>()

  constructor(values: Iterable<T>) {
    for (const value of values) {
      this.#add(value)
    }
  }

  #add(value: T): void {
    if (this.#parent.has(value)) return
    this.#parent.set(value, value)
    this.#members.set(value, new Set([value]))
  }

  /**
   * Returns the representative value for the group containing `value`.
   *
   * @example
   * const set = new DisjointSet(['a', 'b'])
   * set.union('a', 'b')
   * set.find('b') === set.find('a')
   * // => true
   */
  find(value: T): T {
    this.#add(value)

    const parent = this.#parent.get(value)!
    if (parent === value) return value

    const root = this.find(parent)
    this.#parent.set(value, root)
    return root
  }

  /**
   * Returns all values currently grouped with `value`.
   *
   * @example
   * const set = new DisjointSet(['a', 'b', 'c'])
   * set.union('a', 'b')
   * set.members('a')
   * // => Set { 'a', 'b' }
   */
  members(value: T): Set<T> {
    return new Set(this.#members.get(this.find(value)) ?? [value])
  }

  /**
   * Merges the groups containing `valueA` and `valueB`.
   *
   * @example
   * const set = new DisjointSet(['a', 'b'])
   * set.union('a', 'b')
   * set.groups()
   * // => [Set { 'a', 'b' }]
   */
  union(valueA: T, valueB: T): void {
    const rootA = this.find(valueA)
    const rootB = this.find(valueB)
    if (rootA === rootB) return

    const membersA = this.#members.get(rootA)!
    const membersB = this.#members.get(rootB)!
    if (membersA.size < membersB.size) {
      this.union(valueB, valueA)
      return
    }

    for (const value of membersB) {
      this.#parent.set(value, rootA)
      membersA.add(value)
    }
    this.#members.delete(rootB)
  }

  /**
   * Returns every current group.
   *
   * @example
   * const set = new DisjointSet(['a', 'b', 'c'])
   * set.union('a', 'b')
   * set.groups()
   * // => [Set { 'a', 'b' }, Set { 'c' }]
   */
  groups(): Set<T>[] {
    return Array.from(this.#members.values(), members => new Set(members))
  }
}

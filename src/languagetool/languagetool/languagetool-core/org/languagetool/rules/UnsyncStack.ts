// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/UnsyncStack.java faithful
// Java's class extends ArrayList; here it wraps an array and offers the ArrayList methods its
// users call (get, size, remove, lastIndexOf, iteration), because Array.push and Array.pop have
// other return types than Stack's push.
import { List_indexOf } from '../../../../../jdk/java/util/Objects.ts';

/**
 * Implements unsynchronized stack (contrary to default Java {@link java.util.Stack},
 * this one is based on ArrayList). Usage is the same as the java.util.Stack.
 *
 * @author Marcin Miłkowski.
 */
export class UnsyncStack<E> implements Iterable<E> {

  private readonly list: E[] = [];

  constructor() {
  }

  /**
   * Pushes an item onto the top of this stack. This has exactly the same effect
   * as: {@code add(item)}
   *
   * @param item the item to be pushed onto this stack.
   * @return the <code>item</code> argument.
   * @see ArrayList#add
   */
  push(item: E): E {
    this.list.push(item);
    return item;
  }

  /**
   * Removes the object at the top of this stack and returns that object as the
   * value of this function.
   *
   * @return The object at the top of this stack (the last item of the
   *         <code>ArrayList</code> object).
   * @exception EmptyStackException if this stack is empty.
   */
  pop(): E {
    const len = this.size();
    const obj = this.peek();
    this.remove(len - 1);
    return obj;
  }

  /**
   * Looks at the object at the top of this stack without removing it from the
   * stack.
   *
   * @return the object at the top of this stack (the last item of the
   *         <code>ArrayList</code> object).
   * @exception EmptyStackException if this stack is empty.
   */
  peek(): E {
    const len = this.size();
    if (len === 0) {
      throw new Error('EmptyStackException');
    }
    return this.get(len - 1);
  }

  /**
   * Tests if this stack is empty.
   *
   * @return <code>true</code> if and only if this stack contains no items;
   *         <code>false</code> otherwise.
   */
  empty(): boolean {
    return this.size() === 0;
  }

  /**
   * Returns the 1-based position where an object is on this stack. If the
   * object <code>o</code> occurs as an item in this stack, this method returns the
   * distance from the top of the stack of the occurrence nearest the top of the
   * stack; the topmost item on the stack is considered to be at distance
   * <code>1</code>. The <code>equals</code> method is used to compare <code>o</code> to the
   * items in this stack.
   *
   * @param o
   *          the desired object.
   * @return the 1-based position from the top of the stack where the object is
   *         located; the return value <code>-1</code> indicates that the object
   *         is not on the stack.
   */
  search(o: unknown): number {
    const i = this.lastIndexOf(o);
    if (i >= 0) {
      return this.size() - i;
    }
    return -1;
  }

  // ArrayList's methods:

  get(index: number): E {
    if (index < 0 || index >= this.list.length) {
      throw new Error('IndexOutOfBoundsException: Index ' + index + ' out of bounds for length ' + this.list.length);
    }
    return this.list[index]!;
  }

  size(): number {
    return this.list.length;
  }

  remove(index: number): E {
    const obj = this.get(index);
    this.list.splice(index, 1);
    return obj;
  }

  lastIndexOf(o: unknown): number {
    const reversed = [...this.list].reverse();
    const i = List_indexOf(reversed, o);
    return i < 0 ? -1 : this.list.length - 1 - i;
  }

  [Symbol.iterator](): Iterator<E> {
    return this.list[Symbol.iterator]();
  }
}

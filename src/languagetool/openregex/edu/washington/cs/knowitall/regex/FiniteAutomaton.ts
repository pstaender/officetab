// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/edu/washington/cs/knowitall/regex/FiniteAutomaton.java faithful
// The nested classes are exported under their simple names (FiniteAutomaton.Automaton is
// Automaton, ...); FiniteAutomaton itself only holds them. Lists are arrays (subList is slice,
// Lists.reverse a reversed copy, Iterables.any is some), the shared iterators of buildMatch are
// JavaIterators, AtomicInteger is a { value } box. Overloads (Automaton's constructors,
// lookingAt, evaluate, State.connect) are one method with optional parameters.
import type { Predicate } from '../../../../../../jdk/com/google/common/base/Function.ts';
import { AssertionExpression, BaseExpression, type Expression, MatchingGroup } from './Expression.ts';
import { FinalMatch, Group, IntermediateMatch } from './Match.ts';

/** java.util.Iterator over a list. */
class JavaIterator<T> {
    private readonly list: readonly T[];
    private i = 0;

    constructor(list: readonly T[]) {
        this.list = list;
    }

    hasNext(): boolean {
        return this.i < this.list.length;
    }

    next(): T {
        if (this.i >= this.list.length) {
            throw new Error("NoSuchElementException");
        }
        return this.list[this.i++]!;
    }
}

/** java.util.concurrent.atomic.AtomicInteger */
interface AtomicInteger { value: number }

/**
 * A finite automaton implementation.  There is support for epsilon
 * transitions (NFA) but if those are omitted then this works as an
 * implementation of a DFA.
 *
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 */
export class FiniteAutomaton {
}

/**
 * A component automaton with a single start state and a single end
 * state.
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class Automaton<E> {
    readonly start: StartState<E>;
    readonly end: EndState<E>;

    /** Automaton(StartState start, EndState end) or Automaton(Expression expr). */
    constructor(start: StartState<E> | Expression<E>, end?: EndState<E>) {
        if (end !== undefined) {
            this.start = start as StartState<E>;
            this.end = end;
        } else {
            const expr = start as Expression<E>;
            this.start = new StartState<E>(expr);
            this.end = new EndState<E>(expr);
        }
    }

    apply(tokens: E[]): boolean {
        return this.evaluate(tokens, true) != null;
    }

    minMatchingLength(): number {
        return this.start.minMatchingLength();
    }

    /**
     * @return null if no match, otherwise a representation of the match
     */
    lookingAt(tokens: E[], startIndex = 0): FinalMatch<E> | null {
        if (tokens.length - startIndex - this.minMatchingLength() < 0) {
            // don't try if we can't possible match
            return null;
        }
        else {
            const sublist: E[] = tokens.slice(startIndex, tokens.length);

            let path: Step<E> | null = this.evaluate(sublist, startIndex === 0);
            if (path == null) {
                return null;
            }

            // build list of edges
            const edges: AbstractEdge<E>[] = [];
            while (path!.state !== this.start) {
                edges.push(path!.path!);
                path = path!.prev;
            }

            const match = new IntermediateMatch<E>();
            this.buildMatch(new JavaIterator(sublist), null, { value: startIndex }, this.start,
                       new JavaIterator(edges.slice().reverse()), match);
            return new FinalMatch<E>(match);
        }
    }

    /**
     * Retrace the path through the NFA and produce an object that
     * represents the match.
     * @param tokenIterator an iterator over the tokens.
     * @param expression the expression to match.
     * @param index the present index.
     * @param state the present state.
     * @param edgeIterator an iterator over the edges in the solution.
     * @param match the solution.
     * @return
     */
    private buildMatch(tokenIterator: JavaIterator<E>, expression: Expression<E> | null,
            index: AtomicInteger, state: State<E>, edgeIterator: JavaIterator<AbstractEdge<E>>,
            match: IntermediateMatch<E>): State<E> {

        const newMatch = new IntermediateMatch<E>();

        while (edgeIterator.hasNext() && !((state instanceof EndState)
               && (state as EndState<E>).expression === expression)) {

            const edge: AbstractEdge<E> = edgeIterator.next();

            // run the sub-automaton
            if (edge instanceof Edge
                && !((edge as Edge<E>).expression instanceof AssertionExpression)) {
                // consume a token, this is the base case
                const token: E = tokenIterator.next();
                newMatch.add((edge as Edge<E>).expression, token, index.value++);

                state = edge.dest;
            }
            else if (state instanceof StartState) {
                // recurse on StartState so we have a group for that match
                const expr: Expression<E> = (state as StartState<E>).expression;
                state = this.buildMatch(tokenIterator, expr, index, edge.dest, edgeIterator, newMatch);
                // assert(state instanceof EndState<?> && ((EndState<?>)state).expression == expr);
            }
            else {
                // assert(edge instanceof Epsilon<?>);
                state = edge.dest;
            }
        }

        // add the sub match group
        if (expression != null
            && (!newMatch.isEmpty() || expression instanceof MatchingGroup)) {
            // create a wrapper for the expressions it matched
            const pair = new Group<E>(expression);
            for (const p of newMatch.pairs()) {
                if (p.expr instanceof BaseExpression) {
                    pair.addTokens(p);
                }
            }

            // add it
            match.add(pair);
        }

        // add the contents of the sub match group
        match.addAll(newMatch.pairs());

        return state;
    }

    /**
     * Expand all epsilon transitions for the supplied steps.  That is,
     * add all states available via an epsilon transition from a supplied
     * state to the list.
     * @param steps
     */
    private expandEpsilons(steps: Step<E>[]): void {
        const size = steps.length;
        for (let i = 0; i < size; i++) {
            const step: Step<E> = steps[i]!;

            this.expandEpsilon(step, steps);
        }
    }

    /**
     * Expand all epsilon transitions for the specified step.  That is,
     * add all states avaiable via an epsilon transition from step.state.
     * @param step
     * @param steps
     */
    private expandEpsilon(step: Step<E>, steps: Step<E>[]): void {
        // loop over edges
        for (const edge of step.state.epsilons) {

            // try free edges if they do not lead to an existing
            // step
            if (!steps.some((step) => step.state === edge.dest)) {
                const newstep = new Step<E>(edge.dest, step, edge);
                steps.push(newstep);
                this.expandEpsilon(newstep, steps);
            }
        }
    }

    /**
     * Expand any state that has an assertion edge if the assertion passes
     * given the present state.
     * @param steps
     * @param newsteps
     * @param hasStart true iff the tokens contains the start token.
     * @param tokens
     * @param totalTokens
     */
    private expandAssertions(steps: Step<E>[], newsteps: Step<E>[], hasStart: boolean,
                                  tokens: E[], totalTokens: number): void {
        for (const step of steps) {
            for (const edge of step.state.edges) {
                if (edge.expression instanceof AssertionExpression) {
                    const assertion = edge.expression as AssertionExpression<E>;

                    if (assertion.apply(hasStart, tokens, totalTokens)) {
                        newsteps.push(new Step<E>(edge.dest, step, edge));
                    }
                }
            }
        }
    }

    /**
     * evaluate(tokens, hasStart) starts from the start state; with steps:
     *
     * Evaluate the NFA against the list of tokens using the Thompson NFA
     * algorithm.
     * @param tokens the tokens to evaluate against
     * @param steps present list of accessible states.
     * @param hasStart true iff tokens contains the start token.
     * @return a Step object representing the last transition or null.
     */
    private evaluate(tokens: E[], hasStart: boolean, steps?: Step<E>[]): Step<E> | null {
        if (steps === undefined) {
            steps = [];
            steps.push(new Step<E>(this.start));
            return this.evaluate(tokens, hasStart, steps);
        }
        const totalTokens = tokens.length;

        let solutionTokensLeft = totalTokens;
        let solution: Step<E> | null = null;
        while (!(steps.length === 0)) {

            this.expandEpsilons(steps);

            const intermediate: Step<E>[] = steps.slice();
            let newsteps: Step<E>[] = [];
            do {

                // check if at end
                for (const step of intermediate) {
                    if (step.state === this.end) {
                        if (tokens.length === totalTokens) {
                            // can't succeed if no tokens are consumed
                        }
                        else {
                            // we have reached the end
                            if (tokens.length < solutionTokensLeft) {
                                solution = step;
                                solutionTokensLeft = tokens.length;
                            }
                        }
                    }
                }

                // handle assertions
                newsteps.length = 0;
                this.expandAssertions(intermediate, newsteps, hasStart, tokens, totalTokens);
                this.expandEpsilons(newsteps);

                intermediate.length = 0;
                intermediate.push(...newsteps);

                steps.push(...newsteps);
            } while (newsteps.length > 0);

            newsteps = [];
            if (!(tokens.length === 0)) {
                for (const step of steps) {
                    for (const edge of step.state.edges) {
                        // try other edges if they match the current token
                        if (edge.apply(tokens[0]!)) {
                            newsteps.push(new Step<E>(edge.dest, step, edge));
                        }
                    }
                }

                // consume a token
                tokens = tokens.slice(1, tokens.length);
            }

            steps = newsteps;
        }

        return solution;
    }
}

/**
 * A representation of a movement from a state to another, with a
 * backreference to the previous state.  This is used in building
 * a match object once a solution has been found.
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
class Step<E> {
    readonly state: State<E>;
    readonly prev: Step<E> | null;
    readonly path: AbstractEdge<E> | null;

    constructor(state: State<E>, prev: Step<E> | null = null, path: AbstractEdge<E> | null = null) {
        this.state = state;
        this.prev = prev;
        this.path = path;
    }

    toString(): string {
        return this.state.toString();
    }
}

/**
 * Representation of a state in the automaton.
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class State<E> {
    readonly edges: Edge<E>[] = [];
    readonly epsilons: Epsilon<E>[] = [];

    /**
     * Add an epsilon transition between this state and dest.
     * @param dest the state to connect
     *
     * With cost: add an edge between this state and dest.
     * @param dest the state to connect
     * @param cost the expression of the edge
     */
    connect(dest: State<E>, cost?: Expression<E>): void {
        if (cost === undefined) {
            this.epsilons.push(new Epsilon<E>(dest));
            return;
        }
        this.edges.push(new Edge<E>(dest, cost));
    }

    toString(): string {
        return this.constructor.name + ":" + this.edges.length;
    }
}

/**
 * A start or end state.
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class TerminusState<E> extends State<E> {
    readonly expression: Expression<E>;
    constructor(expression: Expression<E>) {
        super();
        this.expression = expression;
    }

    override toString(): string {
        return this.constructor.name
               + "("+this.expression.toString()+"):" + this.edges.length;
    }
}

/**
 * A start state.
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class StartState<E> extends TerminusState<E> {
    constructor(expression: Expression<E>) {
        super(expression);
    }

    minMatchingLength(): number {
        return this.expression.minMatchingLength();
    }
}

/**
 * An end state.
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class EndState<E> extends TerminusState<E> {
    constructor(expression: Expression<E>) {
        super(expression);
    }
}

/**
 * An abstract representation of an edge.
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export abstract class AbstractEdge<E> implements Predicate<E> {
    readonly dest: State<E>;

    constructor(dest: State<E>) {
        this.dest = dest;
    }

    abstract apply(entity: E): boolean;
}

/**
 * An edge with cost {@code expression}.
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class Edge<E> extends AbstractEdge<E> {
    readonly expression: Expression<E>;

    constructor(dest: State<E>, base: Expression<E>) {
        super(dest);
        this.expression = base;
    }

    override toString(): string {
        return "(" + this.expression.toString() + ") -> " + this.dest.toString();
    }

    override apply(entity: E): boolean {
        if (this.expression == null) {
            return true;
        }
        else {
            return this.expression.apply(entity);
        }
    }
}

/**
 * An edge without cost, an epsilon transition.
 * @author Michael Schmitz <schmmd@cs.washington.edu>
 *
 * @param <E>
 */
export class Epsilon<E> extends AbstractEdge<E> {
    constructor(dest: State<E>) {
        super(dest);
    }

    override toString(): string {
        return "(epsilon) -> " + this.dest.toString();
    }

    override apply(_entity: E): boolean {
        return true;
    }
}

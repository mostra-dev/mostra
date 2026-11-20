"use client";

/**
 * The questionnaire (ROUND-3 §1.4, KT-05): questions people answer, each answer a field
 * (`<questionnaire>.<question>`, D52) saved as they go, labelled in results with the options the
 * person saw and whether they took the one recommended. Choices (one or several, with an answer of
 * their own), scales, rankings and text; a comment on any question; required questions, which the
 * trusted Submit waits for; sections; progress; on one page or a step at a time.
 *
 * Ordinary React on native inputs, so it works in either base and anywhere React runs; every part
 * reads the theme's tokens and takes `className`, and `mostra add mostra-questionnaire` copies it
 * into the artifact for editing, where the copy then wins (D68, KT-10).
 */

import { useField } from "@mostra/react";
import { cn } from "cn";
import { ArrowDown, ArrowUp, Check, X } from "lucide-react";
import * as React from "react";

/* -------------------------------------------------------------------------------------------- */
/* The questionnaire                                                                             */

interface QuestionnaireContextValue {
  readonly id: string;
  /** Each question's number on the page, by its ID, in reading order. */
  readonly numbers: ReadonlyMap<string, number>;
  readonly report: (question: string, answered: boolean) => void;
}

const QuestionnaireContext = React.createContext<QuestionnaireContextValue | null>(null);

function useQuestionnaire(part: string): QuestionnaireContextValue {
  const context = React.useContext(QuestionnaireContext);
  if (context === null) throw new Error(`<${part}> belongs inside a <Questionnaire>.`);
  return context;
}

/** The `id`s of the questions under `children`, in reading order, through sections and fragments. */
function questionIds(children: React.ReactNode): string[] {
  const ids: string[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as { id?: unknown; children?: React.ReactNode };
    if (child.type === Question && typeof props.id === "string") ids.push(props.id);
    else if (child.type === Section || child.type === React.Fragment) {
      ids.push(...questionIds(props.children));
    }
  });
  return ids;
}

interface QuestionnaireProps extends Omit<React.ComponentProps<"div">, "id" | "title"> {
  /** The questionnaire's ID: every answer is the field `<id>.<question>`. */
  readonly id: string;
  readonly title?: React.ReactNode;
  readonly description?: React.ReactNode;
  /** `page` (the default): every question at once. `steps`: a section, or a question, at a time. */
  readonly mode?: "page" | "steps";
  /** Show how many questions are answered (the default). */
  readonly progress?: boolean;
}

function Questionnaire({
  id,
  title,
  description,
  mode = "page",
  progress = true,
  className,
  children,
  ...props
}: QuestionnaireProps): React.JSX.Element {
  const ids = questionIds(children);
  const numbers = new Map(ids.map((question, index) => [question, index + 1]));
  const [answered, setAnswered] = React.useState<ReadonlySet<string>>(new Set());
  const report = React.useCallback((question: string, isAnswered: boolean) => {
    setAnswered((current) => {
      if (current.has(question) === isAnswered) return current;
      const next = new Set(current);
      if (isAnswered) next.add(question);
      else next.delete(question);
      return next;
    });
  }, []);
  const context: QuestionnaireContextValue = { id, numbers, report };
  const numbered = numberSections(children);
  const steps = React.Children.toArray(numbered).filter(React.isValidElement);
  const [step, setStep] = React.useState(0);
  const current = Math.min(step, Math.max(steps.length - 1, 0));
  const count = ids.filter((question) => answered.has(question)).length;

  return (
    <QuestionnaireContext.Provider value={context}>
      <div
        data-slot="questionnaire"
        data-mode={mode}
        className={cn("flex flex-col gap-(--stack-gap)", className)}
        {...props}
      >
        {(title !== undefined || description !== undefined || progress) && (
          <header data-slot="questionnaire-header" className="flex flex-col gap-3">
            {title !== undefined && <h1>{title}</h1>}
            {description !== undefined && (
              <p className="max-w-prose text-pretty text-muted-foreground">{description}</p>
            )}
            {progress && ids.length > 0 && <AnswerProgress answered={count} total={ids.length} />}
          </header>
        )}
        {mode === "page"
          ? numbered
          : steps.map((child, index) => (
              // Every step stays mounted, so a required question on a later step still waits for
              // its answer and a submit sends what each step holds (D110).
              <div
                key={child.key ?? index}
                data-slot="questionnaire-step"
                hidden={index !== current}
              >
                {child}
              </div>
            ))}
        {mode === "steps" && steps.length > 1 && (
          <nav
            data-slot="questionnaire-steps"
            aria-label="Steps"
            className="flex items-center justify-between gap-4 border-t border-border pt-5"
          >
            <span className="text-sm text-muted-foreground tabular-nums">
              Step {current + 1} of {steps.length}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                disabled={current === 0}
                onClick={() => setStep(current - 1)}
                className={stepButton("secondary")}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={current === steps.length - 1}
                onClick={() => setStep(current + 1)}
                className={stepButton("primary")}
              >
                Next
              </button>
            </span>
          </nav>
        )}
      </div>
    </QuestionnaireContext.Provider>
  );
}

function stepButton(kind: "primary" | "secondary"): string {
  return cn(
    "press inline-flex h-(--control-h-sm) items-center rounded-button px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40",
    kind === "primary"
      ? "bg-primary text-primary-foreground shadow-button hover:bg-[color-mix(in_oklab,var(--primary),var(--foreground)_14%)]"
      : "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklab,var(--secondary),var(--foreground)_6%)]",
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Sections                                                                                      */

interface SectionProps extends Omit<React.ComponentProps<"section">, "title"> {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  /** Its number, which the questionnaire gives each of its sections in order. */
  readonly index?: number;
}

function Section({
  title,
  description,
  index,
  className,
  children,
  ...props
}: SectionProps): React.JSX.Element {
  const headingId = React.useId();
  return (
    <section
      data-slot="questionnaire-section"
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col gap-8 rounded-(--section-radius) bg-(--section-bg) p-(--section-pad) shadow-(--section-shadow) [border-top:var(--section-rule)]",
        className,
      )}
      {...props}
    >
      <header className="flex flex-col gap-1.5">
        <h2 id={headingId} className="flex items-center gap-[0.6em]">
          {index !== undefined && (
            <span
              data-slot="section-index"
              aria-hidden
              className="grid size-(--section-index-size) shrink-0 place-items-center rounded-full bg-(--section-index-bg) text-[0.8em] text-(--section-index-color) tabular-nums"
            >
              {index}
            </span>
          )}
          <span>{title}</span>
        </h2>
        {description !== undefined && (
          <p className="max-w-prose text-pretty text-muted-foreground">{description}</p>
        )}
      </header>
      {children}
    </section>
  );
}

/** The questionnaire's sections, numbered in order: those it holds directly or in fragments. */
function numberSections(children: React.ReactNode, next = { value: 1 }): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;
    if (child.type === Section) {
      const props = child.props as SectionProps;
      return props.index !== undefined
        ? child
        : React.cloneElement(child as React.ReactElement<SectionProps>, { index: next.value++ });
    }
    if (child.type === React.Fragment) {
      const props = child.props as { children?: React.ReactNode };
      return (
        <React.Fragment key={child.key}>{numberSections(props.children, next)}</React.Fragment>
      );
    }
    return child;
  });
}

/* -------------------------------------------------------------------------------------------- */
/* Questions                                                                                     */

interface QuestionContextValue {
  /** The answer's field: `<questionnaire>.<question>`. */
  readonly field: string;
  readonly label: string | undefined;
  readonly required: boolean;
  readonly multiple: boolean;
  readonly titleId: string;
  readonly descriptionId: string | undefined;
  readonly report: (answered: boolean) => void;
}

const QuestionContext = React.createContext<QuestionContextValue | null>(null);

function useQuestion(part: string): QuestionContextValue {
  const context = React.useContext(QuestionContext);
  if (context === null) throw new Error(`<${part}> belongs inside a <Question>.`);
  return context;
}

/** The text of a title, for results' labels, when it is text. */
function textOf(node: React.ReactNode): string | undefined {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  return undefined;
}

interface QuestionProps extends Omit<React.ComponentProps<"fieldset">, "id" | "title"> {
  /** The question's ID inside its questionnaire: the answer is `<questionnaire>.<id>`. */
  readonly id: string;
  readonly title: React.ReactNode;
  /** What results call it, when the title isn't plain text. */
  readonly label?: string;
  readonly description?: React.ReactNode;
  /** The trusted Submit waits until it is answered. */
  readonly required?: boolean;
  /** Its choices take several answers. */
  readonly multiple?: boolean;
  /** A comment beside the answer: the field `<questionnaire>.<id>.comment`. */
  readonly comments?: boolean;
}

function Question({
  id,
  title,
  label,
  description,
  required = false,
  multiple = false,
  comments = false,
  className,
  children,
  ...props
}: QuestionProps): React.JSX.Element {
  const questionnaire = useQuestionnaire("Question");
  const field = `${questionnaire.id}.${id}`;
  const titleId = React.useId();
  const descriptionId = React.useId();
  const reportTo = questionnaire.report;
  const report = React.useCallback((answered: boolean) => reportTo(id, answered), [reportTo, id]);
  const context = React.useMemo<QuestionContextValue>(
    () => ({
      field,
      label: label ?? textOf(title),
      required,
      multiple,
      titleId,
      descriptionId: description === undefined ? undefined : descriptionId,
      report,
    }),
    [field, label, title, required, multiple, titleId, description, descriptionId, report],
  );
  const choices = React.Children.toArray(children).some(
    (child) => React.isValidElement(child) && (child.type === Choice || child.type === Other),
  );
  const number = questionnaire.numbers.get(id);
  return (
    <QuestionContext.Provider value={context}>
      <fieldset
        data-slot="question"
        aria-describedby={description === undefined ? undefined : descriptionId}
        className={cn("m-0 flex min-w-0 flex-col gap-4 border-0 p-0", className)}
        {...props}
      >
        <legend id={titleId} className="contents">
          <span className="flex items-baseline gap-3 font-heading text-[1.0625rem] leading-snug font-(--heading-weight) tracking-(--heading-tracking) text-balance">
            {number !== undefined && (
              <span
                data-slot="question-number"
                aria-hidden
                className="font-sans text-sm font-semibold text-(--question-number-color) tabular-nums"
              >
                {number}
              </span>
            )}
            <span>
              {title}
              {required ? (
                <span className="ml-2 align-middle font-sans text-xs font-medium text-muted-foreground">
                  Required
                </span>
              ) : null}
            </span>
          </span>
        </legend>
        {description !== undefined && (
          <p id={descriptionId} className="-mt-2 text-sm text-pretty text-muted-foreground">
            {description}
          </p>
        )}
        {choices ? <ChoiceAnswer>{children}</ChoiceAnswer> : children}
        {comments && <Comment />}
      </fieldset>
    </QuestionContext.Provider>
  );
}

/** Reports to the questionnaire whether the question is answered. */
function useAnswered(report: (answered: boolean) => void, answered: boolean): void {
  React.useEffect(() => report(answered), [report, answered]);
  React.useEffect(() => () => report(false), [report]);
}

/* -------------------------------------------------------------------------------------------- */
/* Choices                                                                                       */

interface ChoiceProps {
  /** The value the answer holds when this is chosen. */
  readonly value: string;
  readonly children: React.ReactNode;
  /** What results call it, when its children aren't plain text. */
  readonly label?: string;
  readonly description?: React.ReactNode;
  /** The option the page recommends, marked; a string names the mark ("Our pick"). */
  readonly recommended?: boolean | string;
  /** A figure beside it: a price, a count. */
  readonly meta?: React.ReactNode;
  /** A picture above it: a sketch, a screenshot. */
  readonly media?: React.ReactNode;
  readonly className?: string;
}

/** A choice of a question: rendered by its question, which owns the answer. */
function Choice(_props: ChoiceProps): React.ReactNode {
  return null;
}

interface OtherProps {
  /** Its label: "Something else" unless given. */
  readonly children?: React.ReactNode;
  readonly placeholder?: string;
  readonly className?: string;
}

/** The value an answer of the person's own holds; the text is `<question>.other`. */
const OTHER = "other";

/** An answer of the person's own: chosen, then written. */
function Other(_props: OtherProps): React.ReactNode {
  return null;
}

function ChoiceAnswer({ children }: { readonly children: React.ReactNode }) {
  const question = useQuestion("Choice");
  const items = React.Children.toArray(children).filter(React.isValidElement) as React.ReactElement<
    ChoiceProps | OtherProps
  >[];
  const choices = items.filter((item) => item.type === Choice) as React.ReactElement<ChoiceProps>[];
  const other = items.find((item) => item.type === Other) as
    | React.ReactElement<OtherProps>
    | undefined;
  const otherLabel = textOf(other?.props.children) ?? "Something else";
  const options = [
    ...choices.map((choice) => ({
      value: choice.props.value,
      ...((choice.props.label ?? textOf(choice.props.children)) !== undefined
        ? { label: (choice.props.label ?? textOf(choice.props.children)) as string }
        : {}),
      ...(choice.props.recommended ? { recommended: true } : {}),
    })),
    ...(other ? [{ value: OTHER, label: otherLabel }] : []),
  ];
  const fieldOptions = {
    ...(question.label !== undefined ? { label: question.label } : {}),
    required: question.required,
    options,
  };
  return question.multiple ? (
    <ManyChoices choices={choices} other={other} otherLabel={otherLabel} options={fieldOptions} />
  ) : (
    <OneChoice choices={choices} other={other} otherLabel={otherLabel} options={fieldOptions} />
  );
}

interface ChoiceListProps {
  readonly choices: readonly React.ReactElement<ChoiceProps>[];
  readonly other: React.ReactElement<OtherProps> | undefined;
  readonly otherLabel: string;
  readonly options: {
    readonly label?: string;
    readonly required: boolean;
    readonly options: readonly { value: string; label?: string; recommended?: boolean }[];
  };
}

function OneChoice({ choices, other, otherLabel, options }: ChoiceListProps) {
  const question = useQuestion("Choice");
  const [value, setValue] = useField<string>(question.field, "", options);
  useAnswered(question.report, value !== "");
  const media = choices.some((choice) => choice.props.media !== undefined);
  return (
    <div className="flex flex-col gap-3">
      <div
        role="radiogroup"
        aria-labelledby={question.titleId}
        aria-required={question.required || undefined}
        className={cn("grid gap-2.5", media && "sm:grid-cols-2")}
      >
        {choices.map((choice) => (
          <ChoiceCard
            key={choice.props.value}
            type="radio"
            name={question.field}
            checked={value === choice.props.value}
            onChange={() => setValue(choice.props.value)}
            {...choice.props}
          />
        ))}
        {other && (
          <ChoiceCard
            type="radio"
            name={question.field}
            value={OTHER}
            checked={value === OTHER}
            onChange={() => setValue(OTHER)}
            className={other.props.className}
          >
            {otherLabel}
          </ChoiceCard>
        )}
      </div>
      {other && value === OTHER && (
        <OtherText placeholder={other.props.placeholder} label={otherLabel} />
      )}
      {!question.required && value !== "" && (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label={question.label ? `Clear my answer to “${question.label}”` : "Clear my answer"}
          className="press inline-flex w-fit items-center gap-1.5 rounded-button px-2 py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          <X aria-hidden className="size-3.5" />
          Clear my answer
        </button>
      )}
    </div>
  );
}

function ManyChoices({ choices, other, otherLabel, options }: ChoiceListProps) {
  const question = useQuestion("Choice");
  const [value, setValue] = useField<string[]>(question.field, [], options);
  useAnswered(question.report, value.length > 0);
  const toggle = (choice: string, on: boolean) =>
    setValue((current) =>
      on ? [...current.filter((v) => v !== choice), choice] : current.filter((v) => v !== choice),
    );
  const media = choices.some((choice) => choice.props.media !== undefined);
  return (
    <div className="flex flex-col gap-3">
      <div className={cn("grid gap-2.5", media && "sm:grid-cols-2")}>
        {choices.map((choice) => (
          <ChoiceCard
            key={choice.props.value}
            type="checkbox"
            name={question.field}
            checked={value.includes(choice.props.value)}
            onChange={(event) => toggle(choice.props.value, event.currentTarget.checked)}
            {...choice.props}
          />
        ))}
        {other && (
          <ChoiceCard
            type="checkbox"
            name={question.field}
            value={OTHER}
            checked={value.includes(OTHER)}
            onChange={(event) => toggle(OTHER, event.currentTarget.checked)}
            className={other.props.className}
          >
            {otherLabel}
          </ChoiceCard>
        )}
      </div>
      {other && value.includes(OTHER) && (
        <OtherText placeholder={other.props.placeholder} label={otherLabel} />
      )}
    </div>
  );
}

function OtherText({
  placeholder,
  label,
}: {
  readonly placeholder?: string | undefined;
  readonly label: string;
}) {
  const question = useQuestion("Other");
  const [text, setText] = useField<string>(`${question.field}.other`, "", {
    label: question.label !== undefined ? `${question.label}: ${label}` : label,
  });
  return (
    <input
      type="text"
      data-slot="question-other"
      aria-label={label}
      value={text}
      placeholder={placeholder ?? "Say what you'd choose"}
      onChange={(event) => setText(event.currentTarget.value)}
      className={fieldClasses}
    />
  );
}

interface ChoiceCardProps extends Omit<ChoiceProps, "children" | "value" | "label" | "className"> {
  readonly type: "radio" | "checkbox";
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
  readonly onChange: React.ChangeEventHandler<HTMLInputElement>;
  readonly children: React.ReactNode;
  readonly label?: string;
  readonly className?: string | undefined;
}

function ChoiceCard({
  type,
  name,
  value,
  checked,
  onChange,
  children,
  description,
  recommended,
  meta,
  media,
  className,
}: ChoiceCardProps) {
  const descriptionId = React.useId();
  const body = (
    <>
      <AnswerMark shape={type === "radio" ? "circle" : "square"} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="font-medium">{children}</span>
          {recommended ? (
            <span
              data-slot="recommended"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-highlight group-data-[checked=true]/choice:text-(--choice-selected-fg)"
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-highlight group-data-[checked=true]/choice:bg-answer"
              />
              {typeof recommended === "string" ? recommended : "Recommended"}
            </span>
          ) : null}
        </span>
        {description !== undefined && (
          <span
            id={descriptionId}
            className="text-sm text-muted-foreground group-data-[checked=true]/choice:text-(--choice-selected-muted)"
          >
            {description}
          </span>
        )}
        {media !== undefined && meta !== undefined && (
          <span className="pt-1 text-sm font-medium tabular-nums">{meta}</span>
        )}
      </span>
      {media === undefined && meta !== undefined && (
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums group-data-[checked=true]/choice:text-(--choice-selected-muted)">
          {meta}
        </span>
      )}
    </>
  );
  return (
    <label
      data-slot="choice"
      data-checked={checked}
      className={cn(
        "group/choice press relative flex w-full cursor-pointer rounded-choice bg-(--choice-bg) p-4 text-left shadow-choice transition-[background-color,box-shadow,color] duration-(--state-ms)",
        media !== undefined ? "flex-col gap-4" : "items-start gap-3.5",
        "hover:bg-(--choice-hover-bg) has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40",
        "data-[checked=true]:bg-(--choice-selected-bg) data-[checked=true]:text-(--choice-selected-fg) data-[checked=true]:shadow-(--choice-selected-shadow) data-[checked=true]:hover:bg-(--choice-selected-hover-bg)",
        className,
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        aria-describedby={description !== undefined ? descriptionId : undefined}
        className="absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none rounded-[inherit] opacity-0"
      />
      {media !== undefined ? (
        <>
          <span data-slot="choice-media" className="block w-full">
            {media}
          </span>
          <span className="flex items-start gap-3.5">{body}</span>
        </>
      ) : (
        body
      )}
    </label>
  );
}

/** The mark of an answer: a giallo dot that drops in, the theme's signature move (D179 item 1). */
function AnswerMark({
  shape = "circle",
}: {
  readonly shape?: "circle" | "square";
}): React.JSX.Element {
  return (
    <span
      data-slot="answer-mark"
      aria-hidden
      className={cn(
        "relative mt-px grid size-5 shrink-0 place-items-center border-[1.5px] border-input bg-card transition-colors duration-(--state-ms)",
        "group-data-[checked=true]/choice:border-foreground group-data-[checked=true]/choice:bg-answer",
        shape === "circle" ? "rounded-full" : "rounded-[5px]",
      )}
    >
      {shape === "circle" ? (
        <span className="animate-answer hidden size-2 rounded-full bg-foreground group-data-[checked=true]/choice:block" />
      ) : (
        <Check
          strokeWidth={3}
          className="animate-answer hidden size-3.5 text-foreground group-data-[checked=true]/choice:block"
        />
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Scales                                                                                        */

interface ScaleProps {
  readonly min?: number;
  readonly max?: number;
  /** The words at either end ("Airy", "Dense"). */
  readonly labels?: readonly [string, string];
  readonly className?: string;
}

function Scale({ min = 1, max = 5, labels, className }: ScaleProps): React.JSX.Element {
  const question = useQuestion("Scale");
  const steps = Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
  const [value, setValue] = useField<number | null>(question.field, null, {
    ...(question.label !== undefined ? { label: question.label } : {}),
    required: question.required,
    options: steps.map((step, index) => ({
      value: step,
      label:
        labels !== undefined && index === 0
          ? `${step} (${labels[0]})`
          : labels !== undefined && index === steps.length - 1
            ? `${step} (${labels[1]})`
            : String(step),
    })),
  });
  useAnswered(question.report, value !== null);
  return (
    <div data-slot="scale" className={cn("flex flex-col gap-2.5", className)}>
      <div
        role="radiogroup"
        aria-labelledby={question.titleId}
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((step, index) => (
          <label
            key={step}
            data-slot="scale-step"
            data-checked={value === step}
            className={cn(
              "press relative grid h-12 cursor-pointer place-items-center rounded-control bg-(--choice-bg) text-[0.9375rem] font-medium tabular-nums shadow-choice transition-[background-color,box-shadow] duration-(--state-ms)",
              "hover:bg-(--choice-hover-bg) has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40",
              "data-[checked=true]:bg-(--scale-selected-bg) data-[checked=true]:text-(--scale-selected-fg) data-[checked=true]:shadow-(--scale-selected-shadow)",
            )}
          >
            <input
              type="radio"
              name={question.field}
              value={step}
              checked={value === step}
              onChange={() => setValue(step)}
              aria-label={
                labels !== undefined && index === 0
                  ? `${step}, ${labels[0]}`
                  : labels !== undefined && index === steps.length - 1
                    ? `${step}, ${labels[1]}`
                    : String(step)
              }
              className="absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none rounded-[inherit] opacity-0"
            />
            <span aria-hidden>{step}</span>
          </label>
        ))}
      </div>
      {labels !== undefined && (
        <div aria-hidden className="flex justify-between text-sm text-muted-foreground">
          <span>{labels[0]}</span>
          <span>{labels[1]}</span>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Rankings                                                                                      */

type RankItem = string | { readonly value: string; readonly label: string };

interface RankProps {
  /** What to put in order, in the order shown first. */
  readonly items: readonly RankItem[];
  readonly className?: string;
}

function Rank({ items, className }: RankProps): React.JSX.Element {
  const question = useQuestion("Rank");
  const all = items.map((item) => (typeof item === "string" ? { value: item, label: item } : item));
  const [order, setOrder] = useField<string[] | null>(question.field, null, {
    ...(question.label !== undefined ? { label: question.label } : {}),
    required: question.required,
    options: all.map((item) => ({ value: item.value, label: item.label })),
  });
  useAnswered(question.report, order !== null);
  // An order kept from before keeps what is still offered, then adds what is new at the end.
  const shown =
    order === null
      ? all
      : [
          ...order.flatMap((value) => all.filter((item) => item.value === value)),
          ...all.filter((item) => !order.includes(item.value)),
        ];
  const move = (from: number, to: number) => {
    if (to < 0 || to >= shown.length) return;
    const next = shown.map((item) => item.value);
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved as string);
    setOrder(next);
  };
  return (
    <div data-slot="rank" className={cn("flex flex-col gap-3", className)}>
      <ol aria-labelledby={question.titleId} className="flex flex-col gap-2">
        {shown.map((item, index) => (
          <li
            key={item.value}
            data-slot="rank-item"
            className="flex items-center gap-3 rounded-choice bg-(--choice-bg) py-2 pr-2 pl-4 shadow-choice"
          >
            <span className="w-5 text-sm font-semibold text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <span className="flex-1 font-medium">{item.label}</span>
            <span className="flex gap-1">
              <button
                type="button"
                aria-label={`Move ${item.label} up`}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
                className="press grid size-9 place-items-center rounded-button text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-30"
              >
                <ArrowUp aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Move ${item.label} down`}
                disabled={index === shown.length - 1}
                onClick={() => move(index, index + 1)}
                className="press grid size-9 place-items-center rounded-button text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-30"
              >
                <ArrowDown aria-hidden className="size-4" />
              </button>
            </span>
          </li>
        ))}
      </ol>
      {order === null && (
        <button
          type="button"
          onClick={() => setOrder(shown.map((item) => item.value))}
          className={cn(stepButton("secondary"), "w-fit")}
        >
          Keep this order
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Text                                                                                          */

const fieldClasses =
  "w-full min-w-0 rounded-control border border-input bg-(--field) px-3.5 text-base shadow-control outline-none transition-[border-color,box-shadow] duration-(--state-ms) placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 h-(--control-h)";

interface TextAnswerProps {
  /** Several lines (the default), or one. */
  readonly multiline?: boolean;
  /** For one line: what kind of text, so phones offer the right keys. */
  readonly type?: "text" | "email" | "number" | "url" | "tel" | "date" | "time";
  readonly placeholder?: string;
  readonly className?: string;
}

function TextAnswer({
  multiline = true,
  type = "text",
  placeholder,
  className,
}: TextAnswerProps): React.JSX.Element {
  const question = useQuestion("TextAnswer");
  const [text, setText] = useField<string>(question.field, "", {
    ...(question.label !== undefined ? { label: question.label } : {}),
    required: question.required,
  });
  useAnswered(question.report, text.trim() !== "");
  const shared = {
    "aria-labelledby": question.titleId,
    "aria-describedby": question.descriptionId,
    "aria-required": question.required || undefined,
    value: text,
    placeholder,
  };
  return multiline ? (
    <textarea
      data-slot="text-answer"
      {...shared}
      onChange={(event) => setText(event.currentTarget.value)}
      className={cn(
        fieldClasses,
        "h-auto min-h-28 py-3 leading-relaxed field-sizing-content",
        className,
      )}
    />
  ) : (
    <input
      data-slot="text-answer"
      type={type}
      {...shared}
      onChange={(event) => setText(event.currentTarget.value)}
      className={cn(fieldClasses, className)}
    />
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Comments                                                                                      */

function Comment() {
  const question = useQuestion("Question");
  const [comment, setComment] = useField<string>(`${question.field}.comment`, "", {
    label: question.label !== undefined ? `${question.label}: comment` : "Comment",
  });
  const [open, setOpen] = React.useState(false);
  if (!open && comment === "") {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press inline-flex w-fit items-center rounded-button px-2 py-1 text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        Add a comment
      </button>
    );
  }
  return (
    <textarea
      data-slot="question-comment"
      aria-label={question.label !== undefined ? `Comment on “${question.label}”` : "Comment"}
      value={comment}
      placeholder="Anything to add?"
      // biome-ignore lint/a11y/noAutofocus: it opens because the person asked to write.
      autoFocus={open && comment === ""}
      onChange={(event) => setComment(event.currentTarget.value)}
      className={cn(
        fieldClasses,
        "h-auto min-h-20 py-2.5 text-[0.9375rem] leading-relaxed field-sizing-content",
      )}
    />
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Progress                                                                                      */

interface AnswerProgressProps extends React.ComponentProps<"div"> {
  readonly answered: number;
  readonly total: number;
}

/** How many questions are answered: a dot for each, giallo once answered. */
function AnswerProgress({
  answered,
  total,
  className,
  ...props
}: AnswerProgressProps): React.JSX.Element {
  return (
    <div
      data-slot="answer-progress"
      className={cn("flex items-center gap-3 text-sm text-muted-foreground", className)}
      {...props}
    >
      <span aria-hidden className="flex flex-wrap gap-1.5">
        {Array.from({ length: total }, (_, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the dots are positions, not items.
            key={index}
            className={cn(
              "size-2.5 rounded-full border-[1.5px] border-input transition-colors duration-(--state-ms)",
              index < answered && "animate-answer border-foreground bg-answer",
            )}
          />
        ))}
      </span>
      <span aria-live="polite" className="tabular-nums">
        {answered} of {total} answered
      </span>
    </div>
  );
}

export type {
  AnswerProgressProps,
  ChoiceProps,
  OtherProps,
  QuestionnaireProps,
  QuestionProps,
  RankItem,
  RankProps,
  ScaleProps,
  SectionProps,
  TextAnswerProps,
};
export {
  AnswerMark,
  AnswerProgress,
  Choice,
  Other,
  Question,
  Questionnaire,
  Rank,
  Scale,
  Section,
  TextAnswer,
};

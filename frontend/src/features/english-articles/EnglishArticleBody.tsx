import { Volume2 } from "lucide-react"

import type { EnglishArticleContent, EnglishArticleVocabulary } from "@/api/english-articles"
import { Button } from "@/components/ui/button"
import { articleSectionID } from "./article-sections"

interface EnglishArticleBodyProps {
  content: EnglishArticleContent
  onSpeak?: (text: string) => void
}

function pronunciations(entry: EnglishArticleVocabulary): Array<{ label: string; value: string }> {
  return [
    entry.british_phonetic ? { label: "英", value: entry.british_phonetic } : null,
    entry.american_phonetic ? { label: "美", value: entry.american_phonetic } : null,
  ].filter((value): value is { label: string; value: string } => value !== null)
}

function EnglishParagraph({
  segments,
  translation,
}: {
  segments: EnglishArticleContent["sections"][number]["paragraphs"][number]["segments"]
  translation: string
}) {
  return (
    <div className="grid gap-2">
      <blockquote className="border-l-2 border-primary/45 bg-primary/5 px-4 py-3 leading-8 text-foreground">
        {segments.map((segment, index) => segment.emphasized ? (
          <strong key={index}>
            <u className="decoration-2 underline decoration-foreground underline-offset-4">
              {segment.text}
            </u>
          </strong>
        ) : <span key={index}>{segment.text}</span>)}
      </blockquote>
      <blockquote className="border-l-2 border-border px-4 py-2 leading-7 text-muted-foreground">
        {translation}
      </blockquote>
    </div>
  )
}

function VocabularyEntry({ entry, onSpeak }: { entry: EnglishArticleVocabulary; onSpeak?: (text: string) => void }) {
  const phonetic = pronunciations(entry)
  return (
    <div
      data-vocabulary-entry="true"
      data-testid={`vocabulary-entry-${entry.term}`}
      className="grid min-w-0 gap-2 border-l-2 border-accent bg-accent/35 px-3 py-3"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p data-vocabulary-term className="break-words font-heading text-base font-semibold text-accent-foreground">
            {entry.term}
          </p>
          {phonetic.length > 0 ? (
            <div className="grid gap-0.5 text-xs text-muted-foreground">
              {phonetic.map(({ label, value }) => (
                <p key={label} data-vocabulary-pronunciation className="break-words">{label} {value}</p>
              ))}
            </div>
          ) : null}
        </div>
        {onSpeak ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-pdf-ignore
            title={`朗读 ${entry.term}`}
            aria-label={`朗读 ${entry.term}`}
            onClick={() => onSpeak(entry.term)}
          >
            <Volume2 aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <p data-vocabulary-definition className="break-words text-sm leading-6">
        {entry.part_of_speech ? <strong>{entry.part_of_speech} </strong> : null}
        {entry.definition}
      </p>
      {entry.usage ? <p data-vocabulary-usage className="break-words text-sm leading-6 text-muted-foreground"><span className="font-medium text-foreground">用法：</span>{entry.usage}</p> : null}
      {entry.examples && entry.examples.length > 0 ? (
        <ul className="grid gap-1 pl-5 text-sm leading-6 text-muted-foreground">
          {entry.examples.map((example, index) => <li key={index} data-vocabulary-example>{example}</li>)}
        </ul>
      ) : null}
    </div>
  )
}

export function EnglishArticleBody({ content, onSpeak }: EnglishArticleBodyProps) {
  return (
    <div className="grid gap-10">
      {content.sections.map((section, sectionIndex) => {
        const id = articleSectionID(section.title, sectionIndex)
        return (
          <section key={id} id={id} className="scroll-mt-24 grid gap-5">
            <h2 className="font-heading text-2xl font-semibold leading-tight text-primary">
              {sectionIndex + 1}. {section.title}
            </h2>
            <div className="grid gap-5">
              {section.paragraphs.map((paragraph, paragraphIndex) => (
                <EnglishParagraph key={paragraphIndex} {...paragraph} />
              ))}
            </div>
            {section.vocabulary && section.vocabulary.length > 0 ? (
              <div className="grid gap-3 border-t border-border pt-4">
                <h3 className="font-heading text-lg font-semibold">重点词汇</h3>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  {section.vocabulary.map((entry, entryIndex) => (
                    <VocabularyEntry key={`${entry.term}-${entryIndex}`} entry={entry} onSpeak={onSpeak} />
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

export default EnglishArticleBody

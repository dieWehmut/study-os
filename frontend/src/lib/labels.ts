export function itemTypeLabel(itemType: string): string {
  switch (itemType) {
    case "word_sense":
      return "单词"
    case "phrase":
      return "短语"
    case "collocation":
      return "搭配"
    case "word_family":
      return "词族"
    case "root_affix":
      return "词根词缀"
    case "classic_text":
      return "经典文本"
    case "sentence":
      return "句子"
    default:
      return itemType
  }
}

export function providerLabel(provider: string): string {
  switch (provider) {
    case "mock":
      return "本地"
    case "deepseek":
      return "DeepSeek"
    default:
      return provider
  }
}

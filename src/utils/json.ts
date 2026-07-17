export const stripJson = (text: string): string => {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenced && fenced[1]) return fenced[1].trim();
    return text.trim();
}


import SupportingContextTooltip from "./SupportingContextTooltip";

type Props = {
  text: string;
  id?: string;
};

export default function InfoTooltip({ text, id }: Props) {
  return (
    <SupportingContextTooltip
      id={id}
      text={text}
      align="end"
      placement="bottom"
      className="ml-1"
    />
  );
}

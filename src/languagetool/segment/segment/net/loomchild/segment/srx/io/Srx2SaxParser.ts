// SPDX-License-Identifier: MPL-2.0
// @upstream segment/src/main/java/net/loomchild/segment/srx/io/Srx2SaxParser.java reduced
// The SAX handler is ported as it is, on the events of saxes (namespace aware, as upstream's
// factory). Left out: validation against the SRX 2.0 XML Schema (VALIDATE_PARAMETER is accepted
// and ignored) and logging. The document is passed as a string in place of a Reader.
import { SaxesParser, type SaxesAttributeNS, type SaxesTagNS } from 'saxes';
import { LanguageRule } from '../LanguageRule.ts';
import { Rule } from '../Rule.ts';
import { SrxDocument } from '../SrxDocument.ts';
import type { SrxParser } from '../SrxParser.ts';
import { Util } from '../../util/Util.ts';
import { XmlException } from '../../util/XmlException.ts';

const getParameter = Util.getParameter;

class SrxHandler {
	
	private document: SrxDocument;

	private elementName: string | null = null;
	
	private languageRuleMap!: Map<string, LanguageRule>;
	
	private languageRule!: LanguageRule;
	
	private breakRule!: boolean;
	private beforeBreak!: string;
	private afterBreak!: string;

	
	constructor(document: SrxDocument) {
		this.document = document;
	}
	
	startDocument(): void {
		this.languageRuleMap = new Map<string, LanguageRule>();
		this.beforeBreak = "";
		this.afterBreak = "";
		this.resetRule();
	}

	endDocument(): void {
	}
	
	startElement(localName: string, attributes: Record<string, SaxesAttributeNS>): void {
		this.elementName = localName;
		
		if ("header" === localName) {
			this.document.setCascade("yes" === this.getValue(attributes, "cascade"));
		} else if ("languagerule" === localName) {
			const languageRuleName = this.getValue(attributes, "languagerulename")!;
			this.languageRule = new LanguageRule(languageRuleName);
			this.languageRuleMap.set(this.languageRule.getName(), this.languageRule);
		} else if ("languagemap" === localName) {
			const languagePattern = this.getValue(attributes, "languagepattern")!;
			const languageRuleName = this.getValue(attributes, "languagerulename")!;
			this.document.addLanguageMap(languagePattern, this.languageRuleMap.get(languageRuleName)!);
		} else if ("rule" === localName) {
			this.breakRule = "no" !== this.getValue(attributes, "break");
		}
	}
	
	endElement(localName: string): void {
		this.elementName = null;
		
		if ("rule" === localName) {
			const beforeBreakString = this.beforeBreak;
			const afterBreakString = this.afterBreak;
			const rule = new Rule(this.breakRule, beforeBreakString, afterBreakString);
			this.languageRule.addRule(rule);
			this.resetRule();
		}
	}


	characters(ch: string): void {
		if ("beforebreak" === this.elementName) {
			this.beforeBreak += ch;
		} else if ("afterbreak" === this.elementName) {
			this.afterBreak += ch;
		}
	}
	
	
	fatalError(e: Error): never {
		throw new XmlException("Fatal error parsing SRX", e);
	}

	
	private resetRule(): void {
		this.breakRule = false;
		this.beforeBreak = "";
		this.afterBreak = "";
	}
	
	private getValue(attributes: Record<string, SaxesAttributeNS>, localName: string): string | null {
		for (const attribute of Object.values(attributes)) {
			if (localName === attribute.local) {
				return attribute.value;
			}
		}
		return null;
	}

}

/**
 * Represents SRX 2.0 document parser. Responsible for creating and initializing
 * Document according to given SRX. Uses SAX. Can validate.
 * 
 * @author loomchild
 */
export class Srx2SaxParser implements SrxParser {

	/**
	 * Whether parser should validate input against XML Schema or not.
	 */
	static readonly VALIDATE_PARAMETER = "validate";
	
	/**
	 * Default validate parameter value.
	 */
	static readonly DEFAULT_VALIDATE = true;
	

	/**
	 * Creates SAX parser with given parameters (default parameters if omitted).
	 * @param parameterMap parameters
	 */
	constructor(parameterMap: Map<string, unknown> | Record<string, unknown> = Util.getEmptyParameterMap()) {
		const map = parameterMap instanceof Map ? parameterMap : new Map(Object.entries(parameterMap));
		// Not validated (see the header).
		getParameter(map.get(Srx2SaxParser.VALIDATE_PARAMETER), 
				Srx2SaxParser.DEFAULT_VALIDATE);
	}
	
	/**
	 * Parses SRX document from reader.
	 * 
	 * @param reader
	 * @return initialized document
	 */
	parse(reader: string): SrxDocument {
		const parser = new SaxesParser({ xmlns: true });
		
		const document = new SrxDocument();
		
		const handler = new SrxHandler(document);
		parser.on("error", (e: Error) => handler.fatalError(e));
		parser.on("opentag", (tag: SaxesTagNS) => handler.startElement(tag.local, tag.attributes));
		parser.on("closetag", (tag: SaxesTagNS) => handler.endElement(tag.local));
		parser.on("text", (text: string) => handler.characters(text));
		parser.on("cdata", (text: string) => handler.characters(text));
		handler.startDocument();
		parser.write(reader).close();
		handler.endDocument();

		return document;
	}

}

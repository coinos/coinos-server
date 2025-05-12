#!/usr/bin/python

import argparse, json, logging, sys, requests, os
from pathlib import Path

DEFAULT_FROM_LOCALE = 'en'

def nested_dict_keys(d, _keyname_prefix=''):
    entry_list = []
    for key in d:
        value = d[key]
        if isinstance(value, dict):
            entry_list += nested_dict_keys(value, _keyname_prefix + key + '.')
        else:
            entry_list += [_keyname_prefix + key]
    return entry_list

def localize_string(string_id, from_data, to_data, to_locale):
    api_key = os.environ.get('GOOGLE_API_KEY')
    logging.debug("Translating string with id %s", string_id)
    id_parts = string_id.split('.')

    if id_parts[0] == "lang": return

    # get original string
    to_translate = from_data
    for id_part in id_parts:
        to_translate = to_translate[id_part]

    # Google Translate API endpoint
    url = "http://127.0.0.1:5000/translate"

    # Prepare data for POST request
    data = {
        'q': to_translate,
        'source': 'en',  # assuming the source language is English
        'target': to_locale,
        'format': 'text'
    }

    # Headers for the request
    headers = {"Content-Type": "application/json"}

    # Make the request
    response = requests.post(url, headers=headers, json=data)
    
    # Check if the request was successful
    if response.status_code == 200:
        # Parse the response and extract translation
        translated_text = response.json()['translatedText']
        print("Translated text:", translated_text)
    else:
        print("Error while translating:", response.json())
        translated_text = None

    # Proceed only if translation was successful
    if translated_text:
        # find/create place to put translated string
        translation_location = to_data  # the dictionary or list that should contain the translated string
        for id_part in id_parts[:-1]:
            if id_part not in translation_location:
                translation_location[id_part] = {}
            translation_location = translation_location[id_part]

        translation_location[id_parts[-1]] = translated_text

if __name__ == "__main__":
    # setup and parse commandline arguments
    args_parser = argparse.ArgumentParser(description="guided translation of coinos")
    args_parser.add_argument('from_locale', nargs='?', type=str,
                             help="which locale to translate from")
    args_parser.add_argument('to_locale', nargs='?', type=str,
                             help="which locale to translate to")
    args_parser.add_argument('-v', '--verbose', action='count', default=0,
                             help="show more information (use twice for even more)")
    args_parser.add_argument('-V', '--version', action='store_true',
                             help="show version info and exit")
    args = args_parser.parse_args()

    if args.version:
        print("Guided Translation Script version 0.3.0")
        sys.exit(0)

    from_locale = args.from_locale or input("Which locale do you want to translate from (default: %s)? "
                                            % DEFAULT_FROM_LOCALE) or DEFAULT_FROM_LOCALE
    to_locale = args.to_locale or input("Which locale do you want to translate to? ")
    if not to_locale:
        raise ValueError("You need to specify a language to translate to.")

    if args.verbose >= 2:
        logging.basicConfig(format='%(levelname)s: %(message)s', level=logging.DEBUG)
    elif args.verbose >= 1:
        logging.basicConfig(format='%(levelname)s: %(message)s', level=logging.INFO)
    else:
        logging.basicConfig(format='%(levelname)s: %(message)s')

    # load locale files
    logging.debug("Reading file to convert from (%s.json)", from_locale)
    with open(from_locale + ".json", 'r', encoding='utf-8') as from_file:
        from_json_text = from_file.read()
    logging.debug("Converting from data from JSON to object")
    from_data = json.loads(from_json_text)
    from_id_list = nested_dict_keys(from_data)
    logging.info("Successfully obtained %d strings from locale %s",
                 len(from_id_list), from_locale)
    logging.debug("List of strings: %s", from_id_list)

    logging.debug("Reading file to convert to (%s.json)", to_locale)
    to_filepath = "./" + to_locale + ".json"
    if Path(to_filepath).exists():
        with open(to_locale + ".json", 'r', encoding='utf-8') as to_file:
            to_json_text = to_file.read()
        logging.debug("Converting to data from JSON to object")
        to_data = json.loads(to_json_text)
    to_id_list = nested_dict_keys(to_data)
    logging.info("Successfully obtained %d strings from locale %s",
                 len(to_id_list), to_locale)
    logging.debug("List of strings: %s", to_id_list)

    # offer to remove strings in to list that were removed from from list
    removed_strings = []
    for string_id in to_id_list:
        if string_id not in from_id_list:
            removed_strings.append(string_id)

    if removed_strings:
        print("""There are %d pieces of text that are in the translated locale (%s) but not the original locale (%s).
The IDs of these pieces of text are: %s
This could mean that this text was translated first, or it could mean this text was removed from the original locale but has yet to be removed from the translated locale.  In the latter case, you may want to remove them from the translated locale file.
""" % (len(removed_strings), to_locale, from_locale, removed_strings), file=sys.stderr)

    untranslated_strings = []
    for string_id in from_id_list:
        if string_id not in to_id_list:
            untranslated_strings.append(string_id)

    if untranslated_strings:
        print("There are %d pieces of text to translate: %s"
            % (len(untranslated_strings), untranslated_strings))
        # localize strings!
        try:
            for string_id in untranslated_strings:
                localize_string(string_id, from_data, to_data, to_locale)
                to_id_list.append(string_id)
        except KeyboardInterrupt:
            print("\nProgram interrupted.  Saving strings...")
    else:
        print("Translations already completed.")

    # save localized data
    with open(to_locale + ".json", 'w', encoding='utf-8') as to_file:
        json.dump(to_data, to_file, ensure_ascii=False, indent='\t')
        to_file.write('\n')
    logging.info("Saved %d localized strings to %s.json", len(to_id_list), to_locale)

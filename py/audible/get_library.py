#!/usr/bin/python3

import audible
import json
from os import path

# TODO: hide password

credentials = { 
    "username": "",
    "password": ""
}

if (path.exists("../../config/audible-auth.json")):
    with open("../../config/audible-auth.json") as data_file:
        text = data_file.read()
        credentials = json.loads(text)

def print_captcha_url(url):
    print(url)
    text = input("Captcha: ")
    return text

auth = audible.Authenticator.from_login(
    credentials["username"],
    credentials["password"],
    locale="US",
    with_username=False,
    captcha_callback=print_captcha_url
)

def get_wishlist_page(pageno, numresults):
    result =  client.get(
        "1.0/wishlist",
        num_results=numresults,
        page=pageno,
        response_groups="product_desc, product_attrs",
        sort_by="-DateAdded"
    )
    return result["products"]

with audible.Client(auth=auth) as client:

    output = {
        "library": [],
        "wishlist": []
    }

    library = client.get(
        "1.0/library",
        num_results=1000,
        response_groups="product_desc, product_attrs",
        sort_by="-PurchaseDate"
    )
    for book in library["items"]:
        print(book["title"])
        output["library"].append(book["title"])

    wishlist = []
    wishlistpageidx = 0
    numresults = 50
    
    result = get_wishlist_page(wishlistpageidx, numresults)
    
    while len(result) == numresults:
        wishlist = wishlist + result
        result = get_wishlist_page(wishlistpageidx, numresults)
        wishlistpageidx += 1

    for book in wishlist:
        print(book["title"])
        output["wishlist"].append(book["title"])



with open("../../cache/audible.json", 'w') as outfile:
    json.dump(output, outfile)
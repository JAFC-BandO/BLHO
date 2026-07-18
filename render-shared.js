// Delt render-logik for ét positioneret element -- den ENESTE kilde til hvordan
// titel/tekst/billede/video/rotator/miljoeffekt tegnes op. Bruges af skaerm.html (den rigtige
// Pi-visning) og af redigeringssidens "Live nu paa skaermen"-forhaandsvisning, saa de to
// aldrig kan gaa i utakt med hinanden -- ingen af dem "opfinder" sin egen udgave af renderingen.

const MILJOEFFEKT_URL = 'https://www.boerneloppen.dk/boerneloppen-theme/world_goals/calculateConsumptionVariables.json';

// DR's eget RSS-feed har ingen CORS-header (bekraeftet: `curl -sI` viser ingen
// Access-Control-Allow-Origin) -- en browser kan derfor ikke hente det direkte, uanset
// hvilket JS-bibliotek man bruger. rss2json.com fungerer som mellemled: henter feedet
// server-side og returnerer JSON med CORS aabent. Ingen API-noegle noedvendig til dette
// simple kald (bekraeftet virker).
const DR_RSS_FEED_URL = 'https://www.dr.dk/nyheder/service/feeds/senestenyt';
const RSS2JSON_URL = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(DR_RSS_FEED_URL);

// DR's officielle logo (hvid variant, hentet fra deres egen designmanager-side:
// dr.dk/om-dr/designmanager/dr-koncern/download-drs-logoer), beskaaret og med den
// medfoelgende graa baggrundsboks fjernet (chroma-key), saa kun selve mærket er tilbage
// paa transparent baggrund. Indlejret direkte som data-URI i stedet for at hotlinke til
// dr.dk, saa den ikke er afhaengig af en ekstern fil der kan flytte sig/forsvinde.
const DR_LOGO_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA9wAAADsCAYAAACGwq4tAAAAAklEQVR4AewaftIAACQfSURBVO3BIXjbeIL/4e9P4+eZI1LQHLFSMsjKkTn0cxccszNgnyOWQwYl7eKkLk7swUkd3NZBRxIFHWlsdAM2FltkGQ2KjIoqoQ7R/7rPzf53Z9Juk8aJbH/e1zx69EgAAAAAAOBuOQIAAAAAAHfOEQAAAAAAuHOOAAAAAADAnXMEAAAAAADunCMAAAAAAHDnKvonrLVFvV4XAODzpWmqq6sr/VaapkrT1AhYML7vF2EYCgBQTuPxWH8vSRJlWWaEB2UePXqkjzk6OiparZYAAPMTx7F+laap0jTVB1mWaTKZ6IM0TZWmqRHwAMIwLA4PDwUAWExxHOuDNE2VpqmyLNNkMlGapkrT1AhzYx49eqTrhGFYHB4eCgBQLnEc64MkSZRlmZIk0bt375QkibIsMwLukO/7xZ///GcBAJbXdDrV1dWVkiRRkiSaTCZK09QIX6yij2i1WgIAlI+1Vh9Ya3WNYjqd6t27d4rjWGma6urqSkmSKMsyI+CGwjAUAGC51Wo11Wo1NRoN/SrP82IymSiOYyVJovF4rCzLjHAjFQEAlkqtVtMH1lr9vTzPi8lkoiRJlCSJJpOJkiQxAgAA+A3XdWWtlbVWv5pOp8V4PFYcxxqPx8qyzAifVBEAYCW4ritrray1+jvFdDrVZDJRHMeaTCZKksQIAADgN2q1mmq1mra3t/VBHMfFaDTScDhUmqZG+J2KAAArrVarqVarqdVq6f8UcRwrjmONx2PFcWwEAADwG9ZaWWu1v7+v2WxWDIdDDQYDpWlqhL+qCACA37DWylqr3d1d/a8ijmPFcazxeKw4jo0AAAD+TrVa1fb2tra3tzWdTosoihRFkbIsM1ph5tGjR7rO6elpYa0VAAC/NRqNFMexhsOh0jQ1wtLa29srdnd3BQDAbZyfnyuKIsVxbLSCvlpbW9N1wjDs+r4vAAB+69tvv9V//Md/aGdnR5ubm91vv/22+/bt2+7bt297wlKp1+tda60AALiNIAgUhqE2Nze779+/7yZJ0tMK+WptbU3XCcOw6/u+AAD4lG+++UbfffedfvjhB7Xb7a7v+923b99237592xMWXr1e71prBQDAl/jmm2/UaDTUbre7WZZ1kyTpaQV8tba2puuEYdj1fV8AAHwuz/P03Xff6YcfflC73e56ntdN07SbZVlPWEj1er1rrRUAAHfB8zw1Gg212+1ulmXdJEl6WmJfra2t6TphGHZ93xcAALfheZ6stdrZ2VG9Xu8aY7pJkvSEhVKv17vWWgEAcJc8z1Oj0VC73e6madr9+eefe1pCX62trek6YRh2fd8XAABfyvd9NRoNPXnypPvNN990f/75526WZT2h9Or1etdaKwAA5sHzPP3xj39UvV7vJknSffv2bU9L5Ku1tTVdJwzDru/7AgDgrnz99df67rvvtLOzo42Nje7bt2+7aZr2hNKq1+tda60AAJgn3/f1ww8/yBjTTZKk+/79+56WwFdra2u6ThiGXd/3BQDAPHz77bcKw1Cbm5vd9+/fd5Mk6QmlU6/Xu9ZaAQBwH6y1+s///E9NJpNumqY9Lbiv1tbWdJ0wDLu+7wsAgHn65ptv1Gg01G63u1mWdZMk6QmlUa/Xu9ZaAQBwXzzPUxiGMsZ04zjuaYF9tba2puuEYdj1fV8AANwHz/PUaDTUbre7WZZ1kyTpCQ+uXq93rbUCAOC+WWu1ubnZ/Z//+Z9ulmU9LSBHAACUSLVa1eHhoS4vLwtrbSEAALCyarWaLi4uZK0ttIC+Wltb03XCMOz6vi8AAB6C53kKw1D1er2bJEn37du3PeHe1ev1rrVWAAA8lK+//lphGGo2m3WTJOlpgXy1tram64Rh2PV9XwAAPCTf9/XDDz9obW2t+5e//KX7/v37nnBv6vV611orAAAeWqPR0Pr6enc0GvW0IBwBALAAtre3dXl5qWazWQgAAKykVqulo6OjQgviq7W1NV0nDMOu7/sCAKAsvv76a/3xj3/UxsZG96effuq+f/++J8xVvV7vWmsFAEBZBEGg9fX1bhzH3ffv3/dUYo4AAFgwjUZDl5eXajabhQAAwMpptVo6OztT2TkCAGABua6rly9f6tWrV4XneYUAAMBKqdVqOjo6KlRijgAAWGCNRkMXFxcKgqAQAABYKa1WS0dHR4VKyhEAAAuuWq3qzZs32tnZKQQAAFZKq9XS3t5eoRJyBADAktjf39fR0VHheV4hAACwMnZ3dxWGYaGScQQAwBJptVo6OzuT53mFAADAyjg4OFAQBIVKxBEAAEumVqvp8vJSQRAUAgAAK8F1Xb1+/Vqe5xUqCUcAACwh13V1dnamIAgKAQCAlVCtVnV0dKSycAQAwJJyXVdv3rxRGIaFAADASmg0Gmo2m4VKwBEAAEvu8PBQYRgWAgAAK+Ho6Eie5xV6YI4AAFgBh4eHCsOwEAAAWHqu6+ro6EgPzREAACvi8PBQYRgWAgAAS6/RaMhaW+gBOQIAYIUcHh6q2WwWAgAAS+/Fixd6SI4AAFgxR0dHCoKgEAAAWGrValU7OzuFHogjAABWjOu6Ojs7UxAEhQAAwFLb29uT53mFHoAjAABWkOu6evHihTzPKwQAAJaW67ra2dnRQ3AEAMCKqtVqevXqlQAAwHLb2dmR53mF7pkjAABWmLVWBwcHhQAAwNJyXVdhGOq+VQTcgdlspqurK6H8NjY25LquAPx/29vbiuO4GA6HRgBuLc9zTSYTYblYawUsg52dHQ0GA92nioAvMJ1O9eTJE6VpaoSF5/t+4fu+frW+vi7f9/WB53kKgkAfrK+vq1qtClgmR0dHmkwmRZqmRgBuJM9zPXnyRHEcG2EleJ5XBEGgX9XrdX3g+75839f6+rqq1aqAMqlWqwrDsIiiyOieVAR8gX6/rzRNjbAU0jQ1aZrqV3Ec61M8zyuCINDa2pqCIJDv+/J9X9ZaAYvGdV0dHR1pa2tLAG4miiLFcWyElZFlmYnjWL+K41jXCYKgWF9fVxAEstZqY2NDrusKeCitVktRFOm+VAR8gfF4LKyuLMtMHMf6YDgc6u/5vl/4vq96va4gCLSxsaFqtSqgzKy12tvbK/r9vhGAzzYcDgVcJ0kSkySJhsOhfuX7flGv12WtVbPZlOu6Au6LtVa+7xdpmhrdg4qAL5BlmRFwjTRNTZqmiuNYv/I8r6jX6wqCQNZaWWsFlM3u7q6Gw2GRJIkRAODOpWlqoihSFEXqdDoKgqAIw1DNZlPValXAvIVhqH6/r/tQEQDckyzLzHA41HA41Aee5xX1el3WWjWbTVWrVQFl8OLFC21ubgoAMH9Jkpher6derydrbRGGoVqtloB5CcNQ/X5f9+GrtbU1XScMw67v+wI+5fj4uCfglt6/f9/7+eefez/99FNvMBj0RqNR95dfftG//uu/yvM8AQ/lm2++UZ7n3b/85S89rbh6vd611gr4lPPzc6Vp2hPwhdI07Y1Go97JyUn3l19+0cbGhr7++msBd8nzPI1Go+7bt297mrOv1tbWdJ0wDLu+7wv4lOPj456AO/L27dveTz/91BsMBr3RaNT9l3/5F62vr+vrr78WcN/+/d//Xf/93//dzbKspxVWr9e71loBn3J+fq40TXsC7sj79+97cRz3/uu//qv7yy+/yFor4C798ssv+umnn3qaM0cAUEJJkphOp2P+7d/+zTx//lzT6VTAfXJdVwcHBwIAPJwsy0y/3zd/+MMfFMexgLtSr9d1HxwBQMlFUWQ2NzfN1taW4jgWcF8ajYastYUAAA8qTVOztbVlfvzxRwF3oVaryff9QnPmCAAWRBzHZmtry2xtbSmOYwH3YW9vTwCAchgMBub7779XnucCvlS9Xte8OQKABRPHsdna2jJbW1uazWYC5slaqzAMCwEASiFJEvP48WNNp1MBX8Jaq3lzBAALKo5j8/jxY3N8fCxgnvb29gQAKI8sy0y73dZ0OhVwW/V6XfPmCAAWXL/fN3/4wx80nU4FzEO1WlUYhoUAAKWRZZlpt9uaTqcCbqNarcr3/UJz5AgAlkCapmZzc9McHx8LmIe9vT0BAMolyzLz5MkT5Xku4DY2NjY0T44AYIn0+32ztbWlPM8F3KVqtaowDAsBAEolTVPz5MkTAbcRBIHmyREALJk4js3m5qam06mAu7SzsyMAQPnEcWxOTk4E3JS1VvPkCACWUJqmpt1uazqdCrgrtVpN1tpCAIDS6ff7ms1mAm5iY2ND8+QIAJZUlmWm3W5rNBoJuCthGAoAUD5ZlpleryfgJlzX1Tw5AoAllmWZefr0qRmNRgLuQqvVku/7hQAApTMcDk0cxwJuwlpbaE4cAcAK6HQ6mk6nAu5CGIYCAJTTycmJgJtYW1vTvDgCgBWQZZlpt9uaTqcCvlQYhgIAlNNwODSz2UzA5wqCQPPiCABWRJZl5tmzZ8rzXMCXqFarajabhQAApTQYDAR8Ls/zNC+OAGCFJEliOp2OgC/VaDQEACinKIoEfK4gCDQvjgBgxQyHQ3NyciLgSzSbTQEAyinLMjMajQQ8NEcAsIL6/b6m06mA23JdV81msxAAoJTiOBbwOdbX1zUvjgBgBWVZZrrdroAv0Wg0BAAop+FwKOBzVKtVzYsjAFhRcRybk5MTAbfVbDYFACinNE3NbDYT8JAcAcAK6/f7yvNcwG24rqtms1kIAFBKk8lEwENyBAArLMsyMxgMBNyWtVYAgHJKkkTA5/A8r9AcOAKAFdfv981sNhNwG81mUwCAchqPxwI+RxAEmgdHAAD1+30Bt1GtVuX7fiEAQOmkaSrgITkCACiKIpPnuYDbaDabAgCUT5qmRsADcgQA+KvBYCDgNqy1AgCU03Q6FfBQHAEA/mowGAi4jXq9LgBAOb17907AQ3EEAPirLMvM+fm5gJtyXVdBEBQCAJROlmUCHoojAMDfjEYjAbexsbEhAED5JEki4KE4AgD8zXA4NHmeC7gpa60AAMBiSpJE8+AIAPAPoigScFMbGxsCAACLKcsyozlwBAD4B8PhUMBN1Wo1AQAA/D1HAIB/EMexyfNcwE1ZawsBAAD8H0cAgN8ZDocCbmpjY0MAAGCxTKdTzYsjAMDvxHEs4KZ83xcAAFgs796907w4AgD8zng8FnBTQRAIAAAslizLNC+OAAC/k6apmc1mAm5iY2NDAABgsSRJonlxBAC41ng8FnATrusKAAAslizLNC+OAADXSpJEwE1ZawsBAICFMZlMNC+OAADXmkwmAm5qbW1NAABgcaRpqnlxBAC4VhzHRsANBUEgAEB5WGsFfEye50rT1GhOHAEAPmo6nQq4Cd/3BQAAFsNkMtE8OQIAfNTV1ZWAm/B9XwCA8lhfXxfwMUmSaJ4cAQA+KkkSATextrYmAEB5VKtVAR8Tx7HmyREA4KPSNBVwE7VaTQCAcvB9vxDwCZPJRPPkCADwUVdXVwIAAIvJ930BHzObzZSmqdEcOQIAfFSSJAJuKgiCQgCAB1ev1wV8zHg81rw5AgB8VJZlRsANeZ4nAMDDC4JAwMeMRiPNmyMAwCfNZjMBAIDFU6/XBXzMeDzWvDkCAHzS1dWVgJtYX18XAOBh+b5fuK4r4Dqj0UhZlhnNmSMAAHCnfN8XAOBhNZtNAR8zGo10HxwBAD4pSRIBAIDFYq0V8DHD4VD3wREA4JOyLBMAAFgcnucVjUZDwHVGo5GyLDO6B44AAMCd8jxPAICH02w2BXzM+fm57osjAABwp4IgEADg4ezs7Ai4zmw203A4NLonjgAAnzQejwUAABaDtbao1WoCrhNFke6TIwAAAABYEnt7ewKuk+e5BoOB7pMjAAAAAFgC1trCWivgOlEUKcsyo3vkCAAAAACWwN7enoCPGQwGum+OAAAAAGDBhWFYWGsFXOf4+FhpmhrdM0cAAAAAsMA8zysODg4EXCfPcw0GAz0ERwAAAACwwF69eiXXdQVcZzAYKMsyowfgCAAAAAAW1MHBQWGtFXCd2Wymfr9v9EAcAQAAAMACCsOw2N7eFvAxz54900NyBAAAAAALJgzD4vDwUMDHnJycKI5jowfkCAAAAAAWSBiGxeHhoYCPmc1m6vf7emgVAQAAAMCCODo6KlqtloBPefbsmbIsM3pgFQEAAABAyfm+XxwdHclaK+BTjo+PFcexUQlUBAAAAAAltrOzU+zt7cl1XQGfMhqN1O/3jUqiIgAAAAAoIWttsbe3J2utgH9mOp2q0+moTCoCAAAAgBLxfb/Y29tTq9US8DnyPNezZ8+UZZlRiVQEAPiktbU1AQCA+Ws2m8X29rastQI+V57narfbSpLEqGQqAgB8UhAEAm4ijmMBAD5PEARFGIZqNpuqVqsCburJkydKksSohCoCAAAAgHtkrS2azaaazaaq1aqA23r+/LniODYqqYoAAACAL7CxsaE4jgVcx/f9YmNjQ0EQyFora62AL5XnuXq9nqIoMiqxigAAn+T7vgAAH9doNDQYDITV5ft+4fu+1tbWFASBfN+X7/uy1gq4a3meq91uK0kSo5KrCADwSb7vC7iJJEkErBJrrS4vL4soioTlFgSBPM/Tr6y1Au5Tnudqt9tKksRoAVQEAADu1Lt37wSsmmq1qt3dXQHAvEynU7XbbWVZZrQgKgIAfNLGxoYAAADwcM7Pz9XpdIwWTEUAgE9yXVfATSRJIgAA8OXyPFev11MURUYLqCIAwEcFQVAIuKEsy4wAAMAXmU6nevbsmZIkMVpQFQEAPsrzPAEAAOB+HR8fq9/vGy24igAAH7WxsSHgJuI4FgAAuJ04jtXr9ZQkidESqAgA8FGe5wkAAADzlee5er2eoigyWiIVAQA+ylor4CaSJBEAAPg8eZ5rMBhoMBgoyzKjJVMRAOCjNjY2BNxElmUCAAD/3Pn5ufr9vtI0NVpSFQEAruV5XuG6roCbGI/HAgAA18vzXMPhUP1+X2maGi25igAA1wqCQAAAAPhys9lMURRpMBgoyzKjFVERAOBa9XpdwE3FcWwEAAD+Ko5jnZ+fK4oioxVUEQDgWkEQCLiJ2WwmAABW3Ww2UxRFiqJIaZoarbCKAADXqtfrAm7i6upKAACsotlspuFwqCiKlCSJEf6qIgDA7wRBULiuK+Am4jgWAACrIo5jjUYjDYdDpWlqhN+pCADwO/V6XcBNpWkqAACWVRzHiuNY4/FYcRwb4Z+qCADwO9ZaATc1mUwEAMAyiONYaZoqSRKNx2MlSWKEG6sIAPAPPM8rGo2GgJtKksQIAIAFMZ1O9e7dOyVJoizLNB6Plaap0jQ1wp2oCADwD5rNpoCbiuNYAADclziO9SlpmipNU/0qSRK9e/dOH8RxbIR7UREA4B9YawXcVJIkAgBg3s7Pz9XpdIywEBwBAP7G87yi1WoJuKkkSQQAwLxFUSQsDkcAgL9pNpsCbmM8HgsAgHnrdrvyPK8QFoIjAMDftFotATc1m82UpqkRAABzVqvVdHZ2Jt/3C6H0HAEA/sr3/cJaK+CmxuOxAAC4L7VaTRcXF2o2m4VQao4AAH+1t7cn4DbiOBYAAPfJdV29fPlSBwcHhed5hVBKjgAA8jyvaLVaAm5jPB4LAICHsL29rbOzMwVBUAil4wgAoJ2dHQG3MZvNlKapEQAAD6RWq+nNmzfa29srhFJxBAArzvO8YmdnR8BtDIdDAQBQBru7uzo9PS183y+EUnAEACtub29PrusKuI04jgUAQFlYa3VxcaFms1kID84RAKww3/eL7e1tAbeR57mGw6ERAAAl4rquXr58qVevXhWe5xXCg3EEACvs6OhIwG0Nh0MBAFBWjUZDFxcXstYWwoNwBAArqtlsFtZaAbc1Go0EAECZVatVnZ6e6uDgoBDunSMAWEGe5xVHR0cCbivPcw2HQyMAABbA9va2Li4uiiAICuHeOAKAFfTq1Su5rivgtobDoQAAWCS1Wk1nZ2fa2dkphHvhCABWzM7OTmGtFfAlRqORAABYNK7ran9/X6enp4XneYUwV44AYIVYa4v9/X0BX2I2m2k4HBoBALCgrLW6vLxUs9kshLlxBAArIgiC4vXr1wK+VBRFAgBg0bmuq5cvX+rg4KDwPK8Q7pwjAFgBnucVr1+/luu6Ar5UFEUCAGBZbG9v6+LiQkEQFMKdcgQAS87zvOLs7EzValXAlxqNRkrT1AgAgCVSrVb15s0b7e3tFcKdqQgAlpjnecXZ2ZlqtZqAuzAYDATgenmeazKZCJ9vY2NDrusKKIvd3V1Za4tOp6M0TY3wRSoCgCUVBEHx4sUL1Wo1AXdhNpspjmMjAP9gOp3qyZMnStPUCLcSBEHRbDa1s7Mj13UFPCRrrS4uLtTr9YooioxwaxUBwBIKgqA4OzuT67oC7kq/3xeA3+v3+0rT1Ai3liSJSZJEg8GgODg4UKvVEvCQXNfV4eGhGo1G0el0lGWZEW7MEQAsmTAMizdv3sh1XQF3ZTabKYoiIwC/c3V1JdyNLMtMp9Mxz58/F1AGjUZDFxcXstYWwo05AoAl4Xle8erVq+Lw8FDAXev3+wJwvSRJjHCnoigyW1tbyvNcwEOrVqs6PT3VwcFBIdyIIwBYAtba4uLiQo1GQ8Bdm81miqLICADuURzHZnNzU9PpVEAZbG9v6+LiogiCoBA+iyMAWGCe5xVHR0fF6empqtWqgHno9/sCgIeQpqlpt9sajUYCyqBWq+ns7Ew7OzuF8E85AoAFtbOzU1xeXqrVagmYl9lspiiKjADggWRZZp4+fWpOTk4ElIHrutrf39fp6WnheV4hfJQjAFgwYRgWl5eXxf7+vlzXFTBPvV5PAFAGvV7PPH/+XEBZWGt1eXmpZrNZCNeqCAAWRBiGxd7enqrVqoD7EMexhsOhEQCURBRFZjKZFGdnZ3JdV8BDc11XL1++1MnJSdHv95VlmRH+piIAKDHP84qdnR2FYahqtSrgPvV6PQFA2SRJYjY3N4vXr1+rVqsJKIPt7W01m009efKkSJLECH9VEQCUULPZLBqNhlqtloCHcHJyoiRJjACghNI0Ne12uzg4OFCr1RJQBtVqVW/evNHx8XHR7/eNoIoAoCSazWbRaDTUbDbluq6AhzKbzdTv9wUAZZZlmel0OkrTtNjd3RVQFru7u7LWFp1OR2maGq2wigDggfi+X9TrdVlr1Ww25bqugDLo9XrKsswIABZAv983aZoWBwcHcl1XQBlYa3VxcaFer1dEUWS0oioCgHvi+35Rr9cVBIHq9bpqtZqAshmNRhoOh0YAsECiKDKTyaQ4OzuT67oCysB1XR0eHqrRaBSdTkdZlhmtmIqAL+B5XpFlmRHwG77vFxsbGwqCQNZabWxsyHVdAWU2m83U6XQEAIsoSRLz+PHj4uzsTLVaTUBZNBoNXVxc6NmzZ0Ucx0YrpCLgC9TrdQ2HQ2E1+b5f+L6v9fV1+b6vIAi0vr6uWq0mYBE9e/ZMWZYZAcCCyrLMtNvt4uDgQK1WS0BZVKtVnZ6e6uTkpOj1ekYroiLgC+zt7WkymRRpmhph4QVBUHiep19tbGzI8zx94Pu+fN/XBxsbG3JdV8AyOT4+VhzHRgCw4LIsM51OR2maFru7uwLKZHt7W/V6vXj27JmSJDFachUBX6BWq+nPf/6zZrNZcXV1JZTb2tqaarWaAPyjOI7V7/eNAGCJ9Pt9kyRJcXR0JNd1BZRFrVbT2dmZ+v1+MRgMjJZYRcAdqFarqlarAoBFk+e5nj59KgBYRsPh0FxdXRWvX79WtVoVUBau62p/f1+NRqN4+vSpsiwzWkKOAABYUXmeq91uK8syIwBYUkmSmM3NTU2nUwFlY63V5eWlms1moSXkCACAFdXr9ZQkiREALLksy8zm5qY5Pz8XUDau6+rly5c6OjoqPM8rtEQcAQCwgo6PjxVFkREArJBOp2N+/PFHAWXUarV0cXGhIAgKLQlHAACsmPPzc/X7fSMAWEGDwcD86U9/Up7nAsqmWq3qzZs32tvbK7QEHAEAsELOz8/V6XSMAGCFDYdD0263NZ1OBZTR7u6uLi4uCt/3Cy0wRwAArIjz83N1Oh0jAICSJDHtdltxHAsoo1qtpouLC4VhWGhBOQIAYAWcn5+r0+kYAQD+Jssys7W1Zc7PzwWUkeu6Ojw81KtXrwrP8wotGEcAACy58/NzdTodIwDAtTqdjnn+/LmAsmo0Grq8vJS1ttACcQQAwBI7Pz9Xp9MxAgB8UhRFZmtrS3meCygj13V1enqqg4ODQgvCEQAAS+r8/FydTscIAPBZ4jg27XZb0+lUQFltb2/r4uKiCIKgUMk5AgBgCT1//lydTscIAHAjSZKYdrut0WgkoKxqtZrevHmjnZ2dQiXmCACAJZLnuf70pz8piiIjAMCtZFlmnj59ak5OTgSU2f7+vk5PTwvP8wqVkCMAAJbEbDZTu93WcDg0AgB8sV6vZ54/fy6gzKy1ury8VLPZLFQyjgAAWAKj0Uibm5tKksQIAHBnoigy33//vfI8F1BWruvq5cuXOjo6KjzPK1QSjgAAWHA//vijnj59arIsMwIA3LkkSczm5qam06mAMmu1Wrq4uFAQBIVKwBEAAAtqNpvp+++/12AwMAIAzFWapqbdbms0Ggkos2q1qjdv3mhvb6/QA3MEAMACOjk50ebmppIkMQIA3Issy8zTp0/NycmJgLLb3d3VxcVF4ft+oQfiCACABTKbzbS1taVer2eyLDMCANy7Xq9nnj9/rjzPBZRZrVbTxcWFwjAs9AAcAQCwII6Pj7W5uak4jo0AAA8qiiLTbreV57mAMnNdV4eHh3r16lXheV6he+QIAICSi+NY33//vfr9vsmyzAgAUApJkpjHjx9rOp0KKLtGo6HLy0tZawvdE0cAAJTUbDbT8+fPtbW1ZZIkMQIAlE6WZabdbuv8/FxA2bmuq9PTUx0cHBS6BxUBAFAyeZ5rMBio3+8bAQBKL8sy0+l0lKZpsbu7K6Dstre3Va/Xi2fPnilJEqM5cQQAQEnkea7j42M9fvxY/X7fCACwUPr9vnn+/LnyPBdQdrVaTW/evNHOzk6hOakIAIAHlue5BoOBBoOBsiwzAgAsrCiKzGQyKV6/fq1qtSqg7Pb399VoNIqnT58qyzKjO+QIAIAHkue5jo+P9fjxY/X7fZNlmREAYOElSWI2Nzc1nU4FLAJrrS4vL9VsNgvdoYoAALhns9lM/X5fURQZAQCWUpZlZnNzU0dHR0Wr1RJQdq7r6uXLlzo/Py96vZ6yLDP6QhUBAHBPRqORBoOB4jg2AgCshE6nY5IkKfb39wUsglarpXq9rmfPnhVxHBt9gYoAAJij2WymKIoURZHSNDUCAKycwWBg0jQtjo6O5LqugLKrVqs6PT3V8fFx0e/3jW6pIgAA7lie5xoOh4qiSHEcGwEAVt5wODRXV1fF69evVa1WBSyC3d1dNZvN4smTJ0rT1OiGKgIA4A7kea7hcKjRaKThcGgEAMBvJEliNjc3i1evXslaK2AR1Go1XVxcqN/vF4PBwOgGKgIA4JbyPNdwONRoNNJwODQCAOCfyLLMbG1t6ejoqGi1WgIWgeu62t/fl7W26HQ6yrLM6DNUBADADUynU43HY0VRpCRJjAAAuIVOp2PiOC4ODw8FLIpGo6GLiws9efKkSJLE6J+oCACAT5jNZhqPx4rjWMPhUFmWGQEAcAeiKDJXV1fF69ev5bqugEVQrVb15s0b/fjjj8VgMDD6hIoAAPg70+lUk8lEcRxrPB4rTVMjAADmJI5j0263ixcvXqhWqwlYFPv7+wqCoOh0OkYfUREAYGXNZjNNJhMlSaLxeKwkSZRlmREAAPcoSRLTbreLV69eyVorYFG0Wi39r6LT6RhdoyIAwEqYTqeaTCZK01Tj8VhJkijLMiMAAEogyzKztbWlg4ODYnt7W8CiaLVaiqKoiOPY6DcqAgAsjTzPNZlMlKap0jTVeDxWlmVKksQIAIAF0Ov1TJIkxeHhoYBFEYah4jjWb1X0Eefn57LWCgBQHrPZTFdXV8qyTEmS6IPxeKwsy5QkiRFwx6Io0u7uroCPOT8/F3DXoigyk8mkePHihWq1moBFZR49eqSPOTo6KlqtlgAA85HnuSaTiX6VJImyLNMHSZLo3bt3+iCOYyPggYRhWBweHgr4rel0qna7rSzLjIA5CcOw2NvbU7VaFVBWW1tbiuPY6DfMo0eP9CnW2qJerwsA8PmSJNG7d+/0W0mSKMsyI2DB+L5fhGEo4FdpmiqKIiPgnvi+X9Trdfm+L6BMoihSmqZG1zCPHj0SAAAAAAC4W44AAAAAAMCdcwQAAAAAAO6cIwAAAAAAcOccAQAAAACAO/f/AFCJ19PU1lBbAAAAAElFTkSuQmCC';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function stripInlineFontSize(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('[style]').forEach(node => {
    node.style.fontSize = '';
    if (!node.getAttribute('style').trim()) node.removeAttribute('style');
  });
  return tmp.innerHTML;
}

function youtubeEmbedUrl(url) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (!m) return url;
  const id = m[1];
  return 'https://www.youtube.com/embed/' + id + '?autoplay=1&mute=1&loop=1&controls=0&playlist=' + id;
}

function formatDanskTal(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function buildUrNode(registerInterval) {
  const el = document.createElement('div');
  el.className = 'ur-display';
  const hh = document.createElement('span');
  const colon = document.createElement('span');
  colon.textContent = ':';
  colon.className = 'ur-colon';
  const mm = document.createElement('span');
  el.appendChild(hh);
  el.appendChild(colon);
  el.appendChild(mm);

  // cqw alene passer kun til boksens BREDDE, ikke hoejden -- en streg-tynd eller kvadratisk
  // boks ville faa en tekst der enten er alt for stor (klippes af overflow:hidden) eller alt
  // for lille. Genberegn i stedet ud fra elementets egen, rent faktiske rect (begge akser),
  // virker uanset kontekst (skaerm, Live View, redigerings-canvas) da den ikke er afhaengig
  // af container-type/cqw at regne rigtigt.
  const resize = () => {
    const rect = el.getBoundingClientRect();
    if (rect.width && rect.height) {
      el.style.fontSize = Math.min(rect.height * 0.7, rect.width / 3) + 'px';
    }
  };
  const tick = () => {
    const d = new Date();
    hh.textContent = String(d.getHours()).padStart(2, '0');
    mm.textContent = String(d.getMinutes()).padStart(2, '0');
    colon.style.opacity = d.getSeconds() % 2 === 0 ? '1' : '0';
    resize();
  };
  tick();
  // Foerste maaling lige efter oprettelse rammer altid 0x0 (noden er endnu ikke sat ind i
  // DOM'en af den kaldende funktion) -- CSS'ens 10cqw-fallback slaar saa igennem i et helt
  // sekund foer foerste tick retter den, hvilket saas som stoerrelsen der "hopper". rAF
  // koerer lige foer naeste repaint, efter noden er blevet indsat, saa den rigtige
  // stoerrelse naar at blive sat FOER noget overhovedet naar at blive tegnet paa skaermen.
  requestAnimationFrame(resize);
  registerInterval(setInterval(tick, 1000));
  return el;
}

async function fetchMiljoeffektData() {
  const res = await fetch(MILJOEFFEKT_URL);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function fetchDrNyheder() {
  // Timeout via AbortController: uden dette kan et haengende (aldrig svarende) kald til
  // rss2json.com samle sig op i det uendelige paa en enhed der koerer i ugevis -- hvert
  // hængende fetch-kald ville aldrig blive ryddet op, kun ERSTATTET af det naeste 5-minutters
  // forsoeg, og de kunne derfor ophobe sig som laekkede ressourcer paa svagere hardware.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(RSS2JSON_URL, { signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error('rss2json fejl');
    return data.items.map(item => item.title);
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildNyhedsbannerNode(el, registerInterval) {
  const node = document.createElement('div');
  node.className = 'nyhedsbanner';

  const logo = document.createElement('img');
  logo.className = 'nyhedsbanner-logo';
  logo.src = DR_LOGO_DATA_URI;
  logo.alt = 'DR';
  node.appendChild(logo);

  const viewport = document.createElement('div');
  viewport.className = 'nyhedsbanner-viewport';
  const track = document.createElement('div');
  track.className = 'nyhedsbanner-track';
  track.style.fontSize = (el.fontSize || 1.4) + 'cqw';
  track.style.animationDuration = (el.scrollSekunder || 90) + 's';
  track.textContent = 'Henter nyheder fra DR ...';
  viewport.appendChild(track);
  node.appendChild(viewport);

  let harIndlaestFoerste = false;
  const load = () => {
    fetchDrNyheder().then(overskrifter => {
      // Overskrifterne saettes ind TO GANGE efter hinanden, saa CSS-animationen kan loope
      // saedeloest fra "midt i" den foerste kopi til "midt i" den anden -- ellers ville man
      // se et hak/spring hver gang den naar enden af listen.
      const tekst = overskrifter.map(t => escapeHtml(t)).join(' &nbsp;•&nbsp; ');
      track.innerHTML = tekst + ' &nbsp;•&nbsp; ' + tekst + ' &nbsp;•&nbsp; ';
      harIndlaestFoerste = true;
    }).catch(() => {
      // Behold sidste kendte gode indhold ved en FORBIGAAENDE fejl (rss2json nede,
      // netvaerks-hik) i stedet for at erstatte det med en kort fejltekst -- den korte
      // streng er IKKE doblet, saa den braekker CSS-loopets translateX(-50%)-antagelse og
      // faar banneret til at se ud som om det er gaaet i staa/koerer i slowmotion (praecis
      // det symptom vi har set paa enhederne, men aldrig i en almindelig browser hvor man
      // kun tester kortvarigt og sjaeldent rammer en fejl). Vis kun fejlteksten hvis vi
      // ALDRIG har haft noget rigtigt indhold at falde tilbage paa.
      if (!harIndlaestFoerste) {
        track.textContent = 'Kunne ikke hente nyheder fra DR lige nu.';
      }
    });
  };
  load();
  registerInterval(setInterval(load, 5 * 60000));
  return node;
}

function miljoeffektCardHtml(data) {
  return (
    '<div class="miljoeffekt-box1">' +
      '<div class="miljoeffekt-h4">DU HJÆLPER VERDEN</div>' +
      '<div class="miljoeffekt-desc">Når du køber brugt, gør du en KÆMPE forskel for miljøet.<br>' +
      'Hos Børneloppen er vi stolte!<br>Sammen har vi sparet verden for:</div>' +
    '</div>' +
    '<div class="miljoeffekt-box2">' +
      '<div class="miljoeffekt-amount">' + formatDanskTal(data.savedWaterConsumption) + ' liter vand</div>' +
      '<div class="miljoeffekt-label">Det er vand nok til</div>' +
      '<div class="miljoeffekt-amount">' + formatDanskTal(data.savedToiletFlushes) + ' toiletskyl</div>' +
    '</div>' +
    '<div class="miljoeffekt-box3">' +
      '<div class="miljoeffekt-amount">' + formatDanskTal(data.savedCo2Emissions) + ' kg CO<sub>2</sub></div>' +
      '<div class="miljoeffekt-label">Det er samme udledning som</div>' +
      '<div class="miljoeffekt-amount">' + formatDanskTal(data.savedKmInCar) + ' km i bil</div>' +
    '</div>'
  );
}

// Fletter laaste elementer fra den faelles "master"-skabelon (sabloner-raekken med
// standard=true) ind i en butiks egne elementer. Laaste master-elementer vinder altid over
// en butiks lokale kopi med samme id (fx fra dengang siden blev oprettet ud fra skabelonen),
// saa en aendring superadmin laver i masteren slaar igennem alle steder automatisk -- ingen
// butik skal selv goere noget for at faa opdateringen.
// sideName: navnet paa den side der reelt vises lige nu. Et laast element vises paa ALLE
// sider som udgangspunkt (fx et ur/logo) -- MEDMINDRE det har sit eget kunPaaSide sat, i saa
// fald vises det udelukkende naar sideName matcher praecis det navn.
function mergeMasterElements(storeElements, masterElements, sideName) {
  const lockedMaster = (masterElements || []).filter(e => e.locked && (!e.kunPaaSide || e.kunPaaSide === sideName));
  const lockedIds = new Set(lockedMaster.map(e => e.id));
  const ownOnly = (storeElements || []).filter(e => !lockedIds.has(e.id));
  return lockedMaster.concat(ownOnly);
}

function buildMediaNode(spec) {
  let media;
  if (spec.type === 'video' && spec.kind === 'youtube') {
    media = document.createElement('iframe');
    media.src = youtubeEmbedUrl(spec.url);
    media.setAttribute('frameborder', '0');
    media.setAttribute('allow', 'autoplay; encrypted-media');
  } else if (spec.type === 'billede') {
    media = document.createElement('img');
    media.src = spec.url;
    media.style.objectFit = 'contain';
  } else {
    media = document.createElement('video');
    media.src = spec.url;
    media.muted = true;
    media.autoplay = true;
    media.loop = true;
    media.playsInline = true;
    media.style.objectFit = 'cover';
  }
  media.className = 'el-media';
  return media;
}

// registerInterval: kaldes med et interval-id, saa den side der bruger denne funktion selv
// kan holde styr paa og rydde op i sine egne timere (rotator-skift, miljoeffekt-opdatering)
// naar den tegner om. Uden dette ville hver genrendering efterlade "spøgelses"-timere.
// Regner et sub-elements fuldskaerm-relative x/y/w/h om til koordinater relative til
// rotator-elementets eget omraade (rotatorEl.x/y/w/h er ogsaa fuldskaerm-relative, da
// rotatoren selv er et helt almindeligt top-niveau element).
function remapElementIntoRotator(subEl, rotatorEl) {
  return Object.assign({}, subEl, {
    x: (subEl.x - rotatorEl.x) / rotatorEl.w * 100,
    y: (subEl.y - rotatorEl.y) / rotatorEl.h * 100,
    w: subEl.w / rotatorEl.w * 100,
    h: subEl.h / rotatorEl.h * 100,
  });
}

// Dynamisk butik-navn-tag: lader ÉT faelles titel/tekst-element (typisk i den delte,
// laaste master-skabelon) automatisk vise HVER butiks eget navn i stedet for at skulle
// vaere en separat, haardkodet kopi pr. butik. Sat via saetAktuelButikNavn() FOER en
// rendering (skaerm.html og redigeringssidens Live View saetter den ud fra deres egen
// kendte butik). "Butik "-praefikset fjernes, saa "Butik Horsens" bliver til "Horsens" --
// det er den by/navne-del man reelt vil indsaette i en saetning som "Børneloppen {{butik}}".
let AKTUEL_BUTIK_NAVN = '';
function saetAktuelButikNavn(navn) {
  AKTUEL_BUTIK_NAVN = (navn || '').replace(/^Butik\s+/i, '');
}
function indsaetButikNavn(html) {
  return html.replace(/\{\{\s*butik\s*\}\}/gi, escapeHtml(AKTUEL_BUTIK_NAVN));
}

function buildElNode(el, registerInterval) {
  const node = document.createElement('div');
  node.className = 'el';
  node.dataset.type = el.type;
  node.style.left = el.x + '%';
  node.style.top = el.y + '%';
  node.style.width = el.w + '%';
  // En streg er altid en fast tynd skillelinje, uanset hvad der maatte staa gemt i
  // el.h (aeldre data fra foer redigerings-canvas'et laasede hoejden) -- ellers kan den
  // vise sig som en tyk kasse paa den rigtige skaerm selvom editoren ser rigtig ud.
  node.style.height = el.type === 'streg' ? '0.4%' : (el.h + '%');
  if (el.boxColor) node.style.background = el.boxColor;

  if (el.type === 'titel' || el.type === 'tekst') {
    const t = document.createElement('div');
    t.className = 'el-text';
    t.innerHTML = indsaetButikNavn(el.html != null ? stripInlineFontSize(el.html) : escapeHtml(el.text || ''));
    if (el.fontSize) t.style.fontSize = el.fontSize + 'cqw';
    if (el.textColor) t.style.color = el.textColor;
    node.appendChild(t);
  } else if (el.type === 'billede' && el.url) {
    node.appendChild(buildMediaNode({ type: 'billede', url: el.url }));
  } else if (el.type === 'video' && el.url) {
    node.appendChild(buildMediaNode({ type: 'video', url: el.url, kind: el.kind }));
  } else if (el.type === 'rotator' && Array.isArray(el.slides) && el.slides.length) {
    let idx = 0;
    const showSlide = () => {
      node.innerHTML = '';
      const slide = el.slides[idx];
      if (slide.type === 'side') {
        const inner = document.createElement('div');
        inner.style.cssText = 'position:relative; width:100%; height:100%; overflow:hidden; container-type:inline-size;';
        if (slide.background) inner.style.background = slide.background;
        // En "side" tilfoejet som slide har elementer med koordinater relative til HELE
        // skaermen (saadan som siden ser ud naar den vises for sig selv) -- men rotatoren
        // selv fylder typisk kun en del af skaermen (f.eks. fordi der er en laast sidebar).
        // Uden dette skift bliver koordinaterne genfortolket relativt til rotatorens eget,
        // mindre og forskudte omraade, saa indholdet ser forskudt/forkert skaleret ud.
        (slide.elements || []).forEach(subEl => inner.appendChild(buildElNode(remapElementIntoRotator(subEl, el), registerInterval)));
        node.appendChild(inner);
      } else {
        node.appendChild(buildMediaNode(slide));
      }
      idx = (idx + 1) % el.slides.length;
    };
    showSlide();
    if (el.slides.length > 1) {
      registerInterval(setInterval(showSlide, el.intervalMs || 30000));
    }
  } else if (el.type === 'miljoeffekt') {
    const card = document.createElement('div');
    card.className = 'miljoeffekt-card';
    node.appendChild(card);
    const load = () => {
      fetchMiljoeffektData().then(data => { card.innerHTML = miljoeffektCardHtml(data); }).catch(() => {});
    };
    load();
    registerInterval(setInterval(load, 60000));
  } else if (el.type === 'ur') {
    node.appendChild(buildUrNode(registerInterval));
  } else if (el.type === 'nyhedsbanner') {
    node.appendChild(buildNyhedsbannerNode(el, registerInterval));
  }
  return node;
}
